import {
  getGmailService,
  getEmails,
  clearToken,
  fetchUserProfile,
  getEmailDetails,
  suggestLabelWithRateLimiting,
  getOrCreateLabel,
  addLabelToEmail,
} from "./src/gmail_api.js";
import { getSettings } from "./src/storage.js";
import {
  getProcessedEmailIds,
  addProcessedEmailId,
  clearProcessedEmailIds,
} from "./src/processedIds.js";

document.addEventListener("DOMContentLoaded", () => {
  const signInButton = document.getElementById("sign-in");
  const signOutButton = document.getElementById("sign-out");
  const settingsButton = document.getElementById("settings");
  const messageDiv = document.getElementById("message");
  const emailResults = document.getElementById("email-results");
  const clearLabelsButton = document.getElementById("clear-labels");
  const clearAllButton = document.getElementById("clear-all");

  let authToken = null;

  settingsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  function showOpenSettingsPrompt(text) {
    messageDiv.innerHTML = `<p>${text}</p><button id="open-settings-inline">Open Settings</button>`;
    document
      .getElementById("open-settings-inline")
      .addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  // Sign-in to Gmail
  async function signIn() {
    try {
      authToken = await getGmailService(true);
      messageDiv.textContent = "Signed in successfully!";

      const firstName = await fetchUserProfile(authToken);
      updateUiAfterSignIn(firstName);
    } catch (error) {
      messageDiv.textContent = `Sign-in failed: ${error.message}`;
    }
  }

  signInButton.addEventListener("click", signIn);

  async function signOut() {
    try {
      await clearToken();
      signInButton.style.display = "block";
      clearLabelsButton.style.display = "none";
      clearAllButton.style.display = "none";
      signOutButton.style.display = "none";
      messageDiv.innerHTML = "";
      document.body.style.justifyContent = "center";
      emailResults.textContent = "";
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  signOutButton.addEventListener("click", signOut);

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchAndCategorizeEmails() {
    try {
      if (!authToken) throw new Error("You need to sign in first.");

      const { openaiApiKey } = await getSettings();
      if (!openaiApiKey) {
        showOpenSettingsPrompt(
          "No OpenAI API key configured yet. Add one to start grouping emails."
        );
        return;
      }

      messageDiv.textContent = "Fetching emails...";
      const emails = await getEmails(authToken);

      if (!emails || emails.length === 0) {
        messageDiv.textContent = "No unread emails found.";
        return;
      }

      const processedEmailIds = await getProcessedEmailIds();
      const unprocessedEmails = emails.filter(
        (email) => !processedEmailIds.includes(email.id)
      );

      if (unprocessedEmails.length === 0) {
        messageDiv.textContent = "All emails are already grouped.";
        return;
      }

      messageDiv.textContent = `Categorizing ${unprocessedEmails.length} emails...`;

      let succeeded = 0;
      let failed = 0;

      for (const email of unprocessedEmails) {
        const { id } = email;
        try {
          const emailDetails = await getEmailDetails(authToken, id);
          if (!emailDetails) continue;

          const { subject, body } = emailDetails;

          const label = await suggestLabelWithRateLimiting(subject, body);
          messageDiv.textContent = `Processing: "${subject}"\nApplying Label: "${label}"`;

          const labelId = await getOrCreateLabel(authToken, label);
          await addLabelToEmail(authToken, id, labelId);
          await addProcessedEmailId(id);

          succeeded++;
          await delay(1000); // stay under OpenAI/Gmail rate limits
        } catch (error) {
          console.error(`Error processing email ${id}:`, error);
          failed++;
          // Stop immediately on a missing/invalid API key; there's no point
          // retrying the rest of the batch.
          if (/API key/i.test(error.message)) {
            showOpenSettingsPrompt(error.message);
            return;
          }
        }
      }

      messageDiv.textContent = `Email categorization completed. Labeled ${succeeded}, failed ${failed}.`;
    } catch (error) {
      console.error("Error fetching or categorizing emails:", error);
      messageDiv.textContent = `Error: ${error.message}`;
    }
  }

  // Initialize auth
  async function initializeAuth() {
    try {
      authToken = await getGmailService(false);
      const firstName = await fetchUserProfile(authToken);
      updateUiAfterSignIn(firstName);
    } catch (error) {
      console.log(error.message);
      signInButton.disabled = false;
      signOutButton.disabled = true;
    }
  }

  // Update UI after Sign-in
  function updateUiAfterSignIn(firstName) {
    messageDiv.innerHTML = `
    <h2>Welcome, ${firstName}!</h2>
    <p>Click the button below to group your emails.</p>
    <button id="group-emails">Group Emails</button>
  `;

    document.body.style.justifyContent = "space-between";

    const groupEmailsButton = document.getElementById("group-emails");
    groupEmailsButton.addEventListener("click", fetchAndCategorizeEmails);

    signInButton.style.display = "none";
    signOutButton.style.display = "block";
    clearLabelsButton.style.display = "block";
    clearAllButton.style.display = "block";
  }

  async function clearAll(
    authToken,
    maxLabelsToClear = 250,
    maxEmailsPerLabel = 100
  ) {
    const processedLabels = [];
    const failedLabels = [];

    try {
      const response = await fetch(
        "https://www.googleapis.com/gmail/v1/users/me/labels",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch labels: ${response.statusText}`);
      }

      const data = await response.json();
      const labels = data.labels || [];

      messageDiv.textContent = `Found ${labels.length} labels. Processing...`;

      // Exclude core Gmail labels
      const coreLabels = [
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

      const labelsToProcess = labels.filter(
        (label) =>
          label.type === "user" &&
          !coreLabels.includes(label.name.toUpperCase())
      );

      for (const label of labelsToProcess.slice(0, maxLabelsToClear)) {
        messageDiv.textContent = `Processing label: ${label.name}`;

        try {
          const messagesResponse = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages?q=label:${encodeURIComponent(
              label.name
            )}`,
            {
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            }
          );

          const messagesData = await messagesResponse.json();
          const messages = messagesData.messages || [];

          if (messages.length > 0) {
            const emailIds = messages
              .slice(0, maxEmailsPerLabel)
              .map((msg) => msg.id);
            const batchModifyResponse = await fetch(
              "https://www.googleapis.com/gmail/v1/users/me/messages/batchModify",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${authToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  ids: emailIds,
                  removeLabelIds: [label.id],
                }),
              }
            );

            if (!batchModifyResponse.ok) {
              messageDiv.textContent = `Failed to remove label from emails for label: ${label.name}`;
            }
          }

          const deleteLabelResponse = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/labels/${label.id}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            }
          );

          if (!deleteLabelResponse.ok) {
            failedLabels.push(label.name);
          } else {
            processedLabels.push(label.name);
            messageDiv.textContent = `Deleted label: ${label.name}`;
          }
        } catch (labelError) {
          console.error(`Error processing label ${label.name}:`, labelError);
          failedLabels.push(label.name);
        }
      }

      messageDiv.textContent = `Processing of labels completed. Deleted ${processedLabels.length}, failed ${failedLabels.length}.`;
    } catch (error) {
      console.error("Error in clearAll:", error);
      messageDiv.textContent = `Error in clearAll: ${error.message}`;
    }
  }

  clearLabelsButton.addEventListener("click", async () => {
    await clearProcessedEmailIds();
    clearAll(authToken, 10, 20);
  });

  clearAllButton.addEventListener("click", async () => {
    await clearProcessedEmailIds();
    clearAll(authToken, 250, 100);
  });

  initializeAuth();
});
