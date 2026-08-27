import {
  addLabelToEmail,
  createLabel,
  getEmailDetails,
  getEmails,
  getGmailService,
  listLabels,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/labelProvider.js";
import { getSettings, hasActiveProviderKey } from "./src/storage.js";
import {
  getProcessedEmailIds,
  addProcessedEmailIds,
  clearProcessedEmailIds,
} from "./src/processedIds.js";

// How many emails to label concurrently. Gmail and OpenAI both comfortably
// handle this; keeping it modest avoids bursty rate-limit errors.
const BATCH_SIZE = 5;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setJobStatus(status) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ jobStatus: status }, resolve);
  });
}

async function buildLabelCache(authToken) {
  const labels = await listLabels(authToken);
  return new Map(labels.map((label) => [label.name, label.id]));
}

async function resolveLabelId(authToken, labelCache, labelName) {
  if (labelCache.has(labelName)) return labelCache.get(labelName);
  const newLabel = await createLabel(authToken, labelName);
  labelCache.set(labelName, newLabel.id);
  return newLabel.id;
}

// Labels a single email. Shared by the periodic auto-poll and the manual
// "Group Emails" job triggered from the popup. `labelCache` is a
// name->id Map built once per job so we don't refetch Gmail's whole
// label list for every email.
async function labelSingleEmail(authToken, emailId, labelCache) {
  const emailDetails = await getEmailDetails(authToken, emailId);
  if (!emailDetails) return null;

  const { subject, body } = emailDetails;
  const label = await suggestLabel(subject, body);
  const labelId = await resolveLabelId(authToken, labelCache, label);
  await addLabelToEmail(authToken, emailId, labelId);

  return { subject, label };
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

    const response = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&labelIds=INBOX",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    const data = await response.json();
    if (!data.messages || data.messages.length === 0) {
      console.log("No new unread emails found.");
      return;
    }

    const processedEmailIds = await getProcessedEmailIds();
    const unprocessed = data.messages.filter((m) => !processedEmailIds.includes(m.id));
    if (unprocessed.length === 0) return;

    const labelCache = await buildLabelCache(authToken);
    const doneIds = [];

    for (const message of unprocessed) {
      try {
        const result = await labelSingleEmail(authToken, message.id, labelCache);
        if (result) {
          console.log(`Grouped email "${result.subject}" under label "${result.label}".`);
        }
      } catch (error) {
        console.error(`Error processing new email with ID ${message.id}:`, error);
      }
      doneIds.push(message.id);
    }

    await addProcessedEmailIds(doneIds);
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
        runGroupingJob();
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

async function runGroupingJob() {
  if (groupingInProgress) return;
  groupingInProgress = true;

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

    const authToken = await getGmailService(false);
    const emails = await getEmails(authToken);
    const processedEmailIds = await getProcessedEmailIds();
    const unprocessed = emails.filter((email) => !processedEmailIds.includes(email.id));

    if (unprocessed.length === 0) {
      await setJobStatus({
        jobType: "GROUP",
        running: false,
        message: emails.length === 0 ? "No unread emails found." : "All emails are already grouped.",
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
      const batchDoneIds = [];

      await Promise.all(
        batch.map(async (email) => {
          try {
            await labelSingleEmail(authToken, email.id, labelCache);
            batchDoneIds.push(email.id);
            succeeded++;
          } catch (error) {
            console.error(`Error labeling email ${email.id}:`, error);
            failed++;
            if (/API key/i.test(error.message) && !stopReason) {
              stopReason = error.message;
            }
          } finally {
            completed++;
          }
        })
      );

      if (batchDoneIds.length > 0) {
        await addProcessedEmailIds(batchDoneIds);
      }

      await setJobStatus({
        jobType: "GROUP",
        running: !stopReason,
        needsSettings: Boolean(stopReason),
        current: completed,
        total: unprocessed.length,
        message: stopReason || "Categorizing emails...",
      });

      if (!stopReason && i + BATCH_SIZE < unprocessed.length) {
        await delay(250); // light courtesy pause between batches
      }
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
  if (message?.type === "START_GROUPING") {
    runGroupingJob();
    sendResponse({ started: true });
  } else if (message?.type === "CLEAR_LABELS") {
    runClearJob(message.maxLabelsToClear, message.maxEmailsPerLabel);
    sendResponse({ started: true });
  }
  return false;
});
