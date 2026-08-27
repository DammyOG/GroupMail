import {
  addLabelToEmail,
  getEmailDetails,
  getEmails,
  getGmailService,
  getOrCreateLabel,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/openai_api.js";
import { getSettings } from "./src/storage.js";
import {
  getProcessedEmailIds,
  addProcessedEmailId,
  clearProcessedEmailIds,
} from "./src/processedIds.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setJobStatus(status) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ jobStatus: status }, resolve);
  });
}

// Labels a single email. Shared by the periodic auto-poll and the manual
// "Group Emails" job triggered from the popup.
async function labelSingleEmail(authToken, emailId) {
  const emailDetails = await getEmailDetails(authToken, emailId);
  if (!emailDetails) return null;

  const { subject, body } = emailDetails;
  const label = await suggestLabel(subject, body);
  const labelId = await getOrCreateLabel(authToken, label);
  await addLabelToEmail(authToken, emailId, labelId);

  return { subject, label };
}

// ---------------------------------------------------------------------
// Periodic background auto-poll (chrome.alarms)
// ---------------------------------------------------------------------

async function pollForNewEmails(authToken) {
  try {
    const { openaiApiKey } = await getSettings();
    if (!openaiApiKey) {
      console.log("No OpenAI API key configured yet; skipping auto-poll.");
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

    for (const message of data.messages) {
      if (processedEmailIds.includes(message.id)) {
        continue;
      }

      try {
        const result = await labelSingleEmail(authToken, message.id);
        if (result) {
          console.log(`Grouped email "${result.subject}" under label "${result.label}".`);
        }
      } catch (error) {
        console.error(`Error processing new email with ID ${message.id}:`, error);
      }

      await addProcessedEmailId(message.id);
    }
  } catch (error) {
    console.error("Error polling for new emails:", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("firstOn", { when: Date.now() + 60000 });
  chrome.alarms.create("pollEmails", { periodInMinutes: 15 });
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
});

// ---------------------------------------------------------------------
// Manual "Group Emails" job, triggered from the popup. Runs entirely in
// the service worker so it keeps going even if the popup closes (Chrome
// tears down the popup's JS the instant it loses focus).
// ---------------------------------------------------------------------

let groupingInProgress = false;

async function runGroupingJob() {
  if (groupingInProgress) return;
  groupingInProgress = true;

  try {
    const { openaiApiKey } = await getSettings();
    if (!openaiApiKey) {
      await setJobStatus({
        jobType: "GROUP",
        running: false,
        needsSettings: true,
        message: "No OpenAI API key configured. Open Settings to add one.",
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

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < unprocessed.length; i++) {
      const { id } = unprocessed[i];

      await setJobStatus({
        jobType: "GROUP",
        running: true,
        current: i + 1,
        total: unprocessed.length,
        message: `Categorizing email ${i + 1} of ${unprocessed.length}...`,
      });

      try {
        const result = await labelSingleEmail(authToken, id);
        await addProcessedEmailId(id);
        succeeded++;

        await setJobStatus({
          jobType: "GROUP",
          running: true,
          current: i + 1,
          total: unprocessed.length,
          message: result
            ? `Labeled "${result.subject}" as "${result.label}"`
            : `Processed email ${i + 1} of ${unprocessed.length}`,
        });
      } catch (error) {
        console.error(`Error labeling email ${id}:`, error);
        failed++;

        if (/API key/i.test(error.message)) {
          await setJobStatus({
            jobType: "GROUP",
            running: false,
            needsSettings: true,
            message: error.message,
          });
          return;
        }
      }

      await delay(1000); // stay under OpenAI/Gmail rate limits
    }

    await setJobStatus({
      jobType: "GROUP",
      running: false,
      message: `Done. Labeled ${succeeded}, failed ${failed}.`,
    });
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
// for the same reason.
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

    const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/labels", {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch labels: ${response.statusText}`);
    }

    const data = await response.json();
    const labels = data.labels || [];

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
