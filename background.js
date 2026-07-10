import {
  addLabelToEmail,
  getEmailDetails,
  getGmailService,
  getOrCreateLabel,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/openai_api.js";
import { getSettings } from "./src/storage.js";
import { getProcessedEmailIds, addProcessedEmailId } from "./src/processedIds.js";

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
        continue; // Skip already processed emails
      }

      await processNewEmail(authToken, message.id);
      await addProcessedEmailId(message.id);
    }
  } catch (error) {
    console.error("Error polling for new emails:", error);
  }
}

async function processNewEmail(authToken, emailId) {
  try {
    const emailDetails = await getEmailDetails(authToken, emailId);

    if (emailDetails) {
      const { subject, body } = emailDetails;

      const label = await suggestLabel(subject, body);
      const labelId = await getOrCreateLabel(authToken, label);
      await addLabelToEmail(authToken, emailId, labelId);

      console.log(`Grouped email "${subject}" under label "${label}".`);
    }
  } catch (error) {
    console.error(`Error processing new email with ID ${emailId}:`, error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("firstOn", { when: Date.now() + 60000 }); // Poll once after 1 minute
  chrome.alarms.create("pollEmails", { periodInMinutes: 15 }); // Poll every 15 minutes
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pollEmails" || alarm.name === "firstOn") {
    try {
      // Non-interactive: silently skip if the user isn't signed in rather
      // than popping an auth window during a background alarm.
      const authToken = await getGmailService(false);
      await pollForNewEmails(authToken);
    } catch (error) {
      console.log("Skipping auto-poll (not signed in):", error.message);
    }
  }
});
