import {
  addLabelToEmails,
  createLabel,
  getEmailDetails,
  getEmails,
  getGmailService,
  listLabels,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/labelProvider.js";
import { FALLBACK_LABEL } from "./src/labels.js";
import { getSettings, hasActiveProviderKey } from "./src/storage.js";
import {
  getProcessedEmailIds,
  addProcessedEmailIds,
  clearProcessedEmailIds,
} from "./src/processedIds.js";
import { BUILD_ID } from "./src/buildId.js";
import {
  DEFAULT_LIMIT,
  DEFAULT_SCOPE,
  normalizeLimit,
  normalizeScope,
  queryForScope,
} from "./src/jobOptions.js";

// How many emails to classify concurrently. Each one costs a metadata
// fetch plus one small model call; Gmail's per-user quota and both
// providers' rate limits absorb this comfortably, and 429s are retried
// with backoff rather than avoided by going slowly.
const BATCH_SIZE = 15;

function setJobStatus(status) {
  // A finished status is kept so the popup can show the outcome of a run
  // that ended while it was closed. Stamping it lets the popup say how
  // old it is, so a past failure doesn't read as a live one.
  const stamped = status.running ? status : { ...status, finishedAt: Date.now() };

  return new Promise((resolve) => {
    chrome.storage.local.set({ jobStatus: stamped }, resolve);
  });
}

async function buildLabelCache(authToken) {
  const labels = await listLabels(authToken);
  return new Map(labels.map((label) => [label.name, label.id]));
}

// In-flight label creations, keyed by label name. Shared across jobs so
// the auto-poll and a manual job can't both POST the same brand-new
// label and have Gmail reject the loser.
const labelCreationsInFlight = new Map();

async function resolveLabelId(authToken, labelCache, labelName) {
  if (labelCache.has(labelName)) return labelCache.get(labelName);

  if (!labelCreationsInFlight.has(labelName)) {
    labelCreationsInFlight.set(labelName, createLabelIfMissing(authToken, labelName));
  }

  try {
    const labelId = await labelCreationsInFlight.get(labelName);
    labelCache.set(labelName, labelId);
    return labelId;
  } finally {
    labelCreationsInFlight.delete(labelName);
  }
}

// Names Gmail has refused outright this session. Remembered so a whole
// job doesn't re-attempt a creation that cannot succeed, once per batch.
const rejectedLabelNames = new Set();

// Gmail reserves a set of label names (Spam, Important, Inbox and
// friends) and rejects any attempt to create a user label using one. The
// taxonomy avoids the ones we know about, but rather than lose those
// emails to a failed creation, anything Gmail refuses falls back to the
// generic label.
async function resolveLabelIdOrFallback(authToken, labelCache, labelName) {
  if (rejectedLabelNames.has(labelName)) {
    return resolveLabelId(authToken, labelCache, FALLBACK_LABEL);
  }

  try {
    return await resolveLabelId(authToken, labelCache, labelName);
  } catch (error) {
    if (!error.nameRejected) throw error;

    rejectedLabelNames.add(labelName);
    console.warn(
      `Gmail will not accept a label named "${labelName}" (likely reserved); ` +
        `using "${FALLBACK_LABEL}" for these emails instead.`
    );
    return resolveLabelId(authToken, labelCache, FALLBACK_LABEL);
  }
}

async function createLabelIfMissing(authToken, labelName) {
  try {
    const created = await createLabel(authToken, labelName);
    return created.id;
  } catch (error) {
    if (!error.alreadyExists) throw error;

    const existing = (await listLabels(authToken)).find((l) => l.name === labelName);
    if (!existing) throw error;
    return existing.id;
  }
}

// Classifies one email without touching Gmail's label state — applying
// the labels is deferred so a whole batch can go up in one batchModify
// call per label instead of one modify call per email.
async function classifyEmail(authToken, emailId) {
  const email = await getEmailDetails(authToken, emailId);
  return { id: emailId, label: await suggestLabel(email) };
}

// Classifies `emails` concurrently, then applies the results grouped by
// label. Returns the IDs that made it all the way through, so callers
// only ever mark genuinely-labeled mail as processed.
async function labelEmailBatch(authToken, emails, labelCache) {
  const classified = await Promise.all(
    emails.map(async (email) => {
      try {
        return await classifyEmail(authToken, email.id);
      } catch (error) {
        console.error(`Error classifying email ${email.id}:`, error);
        return { id: email.id, error };
      }
    })
  );

  const idsByLabel = new Map();
  for (const result of classified) {
    if (result.error) continue;
    if (!idsByLabel.has(result.label)) idsByLabel.set(result.label, []);
    idsByLabel.get(result.label).push(result.id);
  }

  const labeledIds = [];
  for (const [labelName, ids] of idsByLabel) {
    try {
      const labelId = await resolveLabelIdOrFallback(authToken, labelCache, labelName);
      await addLabelToEmails(authToken, ids, labelId);
      labeledIds.push(...ids);
    } catch (error) {
      console.error(`Error applying label "${labelName}":`, error);
    }
  }

  const firstError = classified.find((result) => result.error)?.error;
  return { labeledIds, failed: emails.length - labeledIds.length, firstError };
}

// ---------------------------------------------------------------------
// Periodic background auto-poll (chrome.alarms)
// ---------------------------------------------------------------------

async function pollForNewEmails(authToken) {
  try {
    const settings = await getSettings();
    if (!hasActiveProviderKey(settings)) {
      console.log("No API key configured yet; skipping auto-poll.");
      return;
    }

    // The poll is for mail that just arrived, so it stays unread-only no
    // matter what scope the user picked for manual runs.
    const messages = await getEmails(authToken, {
      query: queryForScope("unread"),
      limit: DEFAULT_LIMIT,
    });
    if (messages.length === 0) {
      console.log("No new unread emails found.");
      return;
    }

    const processedEmailIds = await getProcessedEmailIds();
    const unprocessed = messages.filter((m) => !processedEmailIds.has(m.id));
    if (unprocessed.length === 0) return;

    const labelCache = await buildLabelCache(authToken);

    for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
      const batch = unprocessed.slice(i, i + BATCH_SIZE);
      const { labeledIds } = await labelEmailBatch(authToken, batch, labelCache);

      // Only successes are recorded. Anything that failed stays
      // unprocessed so the next poll picks it up again.
      await addProcessedEmailIds(labeledIds);
    }
  } catch (error) {
    console.error("Error polling for new emails:", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("firstOn", { when: Date.now() + 60000 });
  chrome.alarms.create("pollEmails", { periodInMinutes: 15 });
  // Chrome forcibly recycles the service worker roughly every 30s of
  // activity, which can cut a big manual job off mid-batch. This alarm
  // wakes up about once a minute and silently continues any job that
  // got interrupted, so the user never has to babysit or re-click.
  chrome.alarms.create("resumeJobs", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pollEmails" || alarm.name === "firstOn") {
    try {
      const authToken = await getGmailService(false);
      await pollForNewEmails(authToken);
    } catch (error) {
      console.log("Skipping auto-poll (not signed in):", error.message);
    }
  }

  if (alarm.name === "resumeJobs") {
    chrome.storage.local.get("jobStatus", (result) => {
      const status = result.jobStatus;
      if (!status || !status.running) return;

      // If `running` is still true here, the worker that was processing
      // this job got killed before it could write a final status update
      // (in-memory guard flags reset to false on every fresh worker
      // spin-up, so a stale `running: true` is how we detect this).
      if (status.jobType === "GROUP" && !groupingInProgress) {
        runGroupingJob(status.scope ?? DEFAULT_SCOPE, status.limit ?? DEFAULT_LIMIT);
      } else if (status.jobType === "CLEAR" && !clearInProgress) {
        runClearJob(status.maxLabelsToClear ?? 250, status.maxEmailsPerLabel ?? 100);
      }
    });
  }
});

// ---------------------------------------------------------------------
// Manual "Group Emails" job, triggered from the popup. Runs entirely in
// the service worker so it keeps going even if the popup closes (Chrome
// tears down the popup's JS the instant it loses focus). Emails are
// labeled in small concurrent batches, and the resumeJobs alarm above
// picks it back up automatically if the worker gets recycled mid-job.
// ---------------------------------------------------------------------

let groupingInProgress = false;

async function runGroupingJob(rawScope, rawLimit) {
  if (groupingInProgress) return;
  groupingInProgress = true;

  const scope = normalizeScope(rawScope);
  const limit = normalizeLimit(rawLimit);

  try {
    const settings = await getSettings();
    if (!hasActiveProviderKey(settings)) {
      await setJobStatus({
        jobType: "GROUP",
        running: false,
        needsSettings: true,
        message: "No API key configured. Open Settings to add one.",
      });
      return;
    }

    // Recorded before the (potentially slow) listing call so that a
    // worker recycle during it still resumes, and resumes with the same
    // scope and limit the user actually chose.
    await setJobStatus({
      jobType: "GROUP",
      running: true,
      scope,
      limit,
      message: "Fetching emails...",
    });

    const authToken = await getGmailService(false);
    const emails = await getEmails(authToken, { query: queryForScope(scope), limit });
    const processedEmailIds = await getProcessedEmailIds();
    const unprocessed = emails.filter((email) => !processedEmailIds.has(email.id));

    if (unprocessed.length === 0) {
      await setJobStatus({
        jobType: "GROUP",
        running: false,
        message:
          emails.length === 0
            ? "No matching emails found."
            : "All emails in range are already grouped.",
      });
      return;
    }

    const labelCache = await buildLabelCache(authToken);

    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    let stopReason = null;

    for (let i = 0; i < unprocessed.length && !stopReason; i += BATCH_SIZE) {
      const batch = unprocessed.slice(i, i + BATCH_SIZE);
      const result = await labelEmailBatch(authToken, batch, labelCache);

      if (result.labeledIds.length > 0) {
        await addProcessedEmailIds(result.labeledIds);
      }

      succeeded += result.labeledIds.length;
      failed += result.failed;
      completed += batch.length;

      // A bad API key fails every email identically — stop rather than
      // grind through the rest of the mailbox producing the same error.
      if (result.firstError && /API key/i.test(result.firstError.message)) {
        stopReason = result.firstError.message;
      }

      await setJobStatus({
        jobType: "GROUP",
        running: !stopReason,
        needsSettings: Boolean(stopReason),
        scope,
        limit,
        current: completed,
        total: unprocessed.length,
        message: stopReason || "Categorizing emails...",
      });
    }

    if (!stopReason) {
      await setJobStatus({
        jobType: "GROUP",
        running: false,
        message: `Done. Labeled ${succeeded}, failed ${failed}.`,
      });
    }
  } catch (error) {
    console.error("Grouping job failed:", error);
    await setJobStatus({
      jobType: "GROUP",
      running: false,
      message: `Error: ${error.message}`,
    });
  } finally {
    groupingInProgress = false;
  }
}

// ---------------------------------------------------------------------
// Manual "Clear Labels" / "Clear All" job, also run in the background
// for the same reason, with the same auto-resume support.
// ---------------------------------------------------------------------

const CORE_LABELS = [
  "INBOX",
  "CHAT",
  "SPAM",
  "TRASH",
  "IMPORTANT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "STARRED",
  "SENT",
  "DRAFTS",
  "CHATS",
  "DRAFT",
  "UNREAD",
  "ALL_MAIL",
];

let clearInProgress = false;

async function runClearJob(maxLabelsToClear, maxEmailsPerLabel) {
  if (clearInProgress) return;
  clearInProgress = true;

  try {
    await clearProcessedEmailIds();
    const authToken = await getGmailService(false);
    const labels = await listLabels(authToken);

    const labelsToProcess = labels
      .filter((label) => label.type === "user" && !CORE_LABELS.includes(label.name.toUpperCase()))
      .slice(0, maxLabelsToClear);

    if (labelsToProcess.length === 0) {
      await setJobStatus({ jobType: "CLEAR", running: false, message: "No labels to clear." });
      return;
    }

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < labelsToProcess.length; i++) {
      const label = labelsToProcess[i];

      await setJobStatus({
        jobType: "CLEAR",
        running: true,
        current: i + 1,
        total: labelsToProcess.length,
        maxLabelsToClear,
        maxEmailsPerLabel,
        message: `Processing label: ${label.name}`,
      });

      try {
        const messagesResponse = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages?q=label:${encodeURIComponent(label.name)}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const messagesData = await messagesResponse.json();
        const messages = messagesData.messages || [];

        if (messages.length > 0) {
          const emailIds = messages.slice(0, maxEmailsPerLabel).map((msg) => msg.id);
          await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/batchModify", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ids: emailIds, removeLabelIds: [label.id] }),
          });
        }

        const deleteResponse = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/labels/${label.id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } }
        );

        if (!deleteResponse.ok) {
          failed++;
        } else {
          processed++;
        }
      } catch (labelError) {
        console.error(`Error processing label ${label.name}:`, labelError);
        failed++;
      }
    }

    await setJobStatus({
      jobType: "CLEAR",
      running: false,
      message: `Done. Deleted ${processed} labels, failed ${failed}.`,
    });
  } catch (error) {
    console.error("Clear job failed:", error);
    await setJobStatus({
      jobType: "CLEAR",
      running: false,
      message: `Error: ${error.message}`,
    });
  } finally {
    clearInProgress = false;
  }
}

// ---------------------------------------------------------------------
// Messages from the popup
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Lets the Settings page detect that this worker is running older code
  // than the files on disk. Answering also wakes an idle worker, so the
  // reply reflects a real running worker rather than a cached value.
  if (message?.type === "GET_BUILD_ID") {
    sendResponse({ buildId: BUILD_ID });
    return false;
  }

  if (message?.type === "START_GROUPING") {
    runGroupingJob(message.scope, message.limit);
    sendResponse({ started: true });
  } else if (message?.type === "CLEAR_LABELS") {
    runClearJob(message.maxLabelsToClear, message.maxEmailsPerLabel);
    sendResponse({ started: true });
  }
  return false;
});
