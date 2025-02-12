import {
  addLabelToEmail,
  getEmailDetails,
  getGmailService,
  getOrCreateLabel,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/openai_api.js";

function getProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.get("processedEmailIds", (result) => {
      console.log("Stored processed email IDs:", result);
      resolve(result.processedEmailIds || []); // Return empty array if no data
    });
  });
}

async function addProcessedEmailId(id) {
  const processedIds = await getProcessedEmailIds(); // Ensure processedIds is always an array
  if (!Array.isArray(processedIds)) {
    console.error(
      "processedEmailIds is not an array. Resetting to an empty array."
    );
    processedIds = [];
  }
  processedIds.push(id);
  chrome.storage.local.set({ processedEmailIds: processedIds });
}

async function pollForNewEmails(authToken) {
  try {
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
        console.log(`Email ID ${message.id} already processed.`);
        continue; // Skip already processed emails
      }

      console.log("New unread email detected:", message);
      await processNewEmail(authToken, message.id); // Process the new email

      // Mark as processed
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

      // Suggest a label
      const label = await suggestLabel(subject, body);

      // Get or create the label
      const labelId = await getOrCreateLabel(authToken, label);

      // Add the label to the email
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
  if (alarm.name === "pollEmails") {
    console.log("Polling Gmail for new emails...");
    const authToken = await getGmailService();
    pollForNewEmails(authToken);
  }

  if (alarm.name === "firstOn") {
    console.log("Polling Gmail for new emails...");
    const authToken = await getGmailService();
    pollForNewEmails(authToken);
  }
});
