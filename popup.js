import {
  getGmailService,
  getEmails,
  clearToken,
  fetchUserProfile,
  displayCategorizedEmails,
  getEmailDetails,
  suggestLabelWithRateLimiting,
  getOrCreateLabel,
  addLabelToEmail,
} from "./src/gmail_api.js";
import { suggestLabel } from "./src/openai_api.js";
import { labelEmails } from "./src/labeler.js";

document.addEventListener("DOMContentLoaded", () => {
  function syncChromeStorageToLocalStorage() {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error fetching chrome.storage.local data:",
          chrome.runtime.lastError
        );
        return;
      }

      // Iterate through all keys in chrome.storage.local
      for (const [key, value] of Object.entries(items)) {
        // Store each key-value pair in localStorage
        localStorage.setItem(key, JSON.stringify(value));
      }

      console.log("Synced chrome.storage.local to localStorage.");
    });
  }

  syncChromeStorageToLocalStorage();

  const signInButton = document.getElementById("sign-in");
  const signOutButton = document.getElementById("sign-out");
  const messageDiv = document.getElementById("message");
  const emailResults = document.getElementById("email-results");
  const clearLabelsButton = document.getElementById("clear-labels");
  const clearAllButton = document.getElementById("clear-all");

  let authToken = null;

  // Sign-in to Gmail
  async function signIn() {
    try {
      console.log("A button was clicked");
      authToken = await getGmailService();
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
      console.log("All cached tokens cleared.");
      signInButton.style.display = "block";
      clearLabelsButton.style.display = "none";
      signOutButton.style.display = "none";
      messageDiv.innerHTML = "";
      const body = document.body;
      body.style.justifyContent = "center";
      emailResults.textContent = "";
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  signOutButton.addEventListener("click", signOut);

  // Fetch and Categorize Emails
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getProcessedEmailIds() {
    const storedIds = localStorage.getItem("processedEmailIds");
    return storedIds ? JSON.parse(storedIds) : [];
  }

  function addProcessedEmailId(id) {
    const processedIds = getProcessedEmailIds();
    processedIds.push(id);
    localStorage.setItem("processedEmailIds", JSON.stringify(processedIds));
  }

  function clearProcessedEmailIds() {
    localStorage.removeItem("processedEmailIds");
    chrome.storage.local.remove("processedEmailIds", () => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error clearing processed email IDs:",
          chrome.runtime.lastError
        );
      } else {
        console.log("Processed email IDs cleared from chrome.storage.local.");
      }
    });
  }

  async function fetchAndCategorizeEmails() {
    try {
      if (!authToken) throw new Error("You need to sign in first.");

      messageDiv.textContent = "Fetching emails...";
      const emails = await getEmails(authToken);

      if (!emails || emails.length === 0) {
        messageDiv.textContent = "No unread emails found.";
        return;
      }

      const processedEmailIds = getProcessedEmailIds();
      const unprocessedEmails = emails.filter(
        (email) => !processedEmailIds.includes(email.id)
      );

      if (unprocessedEmails.length === 0) {
        messageDiv.textContent = "All emails are already grouped.";
        return;
      }

      messageDiv.textContent = `Categorizing ${unprocessedEmails.length} emails...`;

      for (const email of unprocessedEmails) {
        const { id } = email;
        const emailDetails = await getEmailDetails(authToken, id);

        if (emailDetails) {
          const { subject, body } = emailDetails;

          // Suggest label
          const label = await suggestLabelWithRateLimiting(subject, body);

          // Show progress in the UI
          messageDiv.textContent = `Processing: "${subject}"\nApplying Label: "${label}"`;

          // Get or create label in Gmail
          const labelId = await getOrCreateLabel(authToken, label);

          // Add label to email
          await addLabelToEmail(authToken, id, labelId);

          // Mark email as processed
          addProcessedEmailId(id);

          console.log(`Added label "${label}" to email "${subject}"`);

          // Delay to simulate processing
          await delay(1000); // 1-second delay between each email
        }
      }

      messageDiv.textContent = "Email categorization completed.";
    } catch (error) {
      console.error("Error fetching or categorizing emails:", error);
      messageDiv.textContent = `Error: ${error.message}`;
    }
  }

  //   Initialize auth
  async function initializeAuth() {
    try {
      authToken = await getGmailService();
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

    // Attach event handler for grouping emails
    const groupEmailsButton = document.getElementById("group-emails");
    groupEmailsButton.addEventListener("click", fetchAndCategorizeEmails);

    signInButton.style.display = "none";
    signOutButton.style.display = "block";
    clearLabelsButton.style.display = "block";
  }

  async function clearAll(
    authToken,
    maxLabelsToClear = 250,
    maxEmailsPerLabel = 100
  ) {
    const processedLabels = []; // Collect processed labels
    const failedLabels = []; // Collect labels that failed to process

    try {
      // Fetch all labels
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
      const labels = data.labels;

      console.log(`Found ${labels.length} labels.`);
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

      console.log(
        "Labels to process:",
        labelsToProcess.map((label) => label.name)
      );

      // Process labels
      for (const label of labelsToProcess.slice(0, maxLabelsToClear)) {
        console.log(`Processing label: ${label.name} (ID: ${label.id})`);
        messageDiv.textContent = `Processing label: ${label.name}`;

        try {
          // Fetch emails with this label
          const messagesResponse = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages?q=label:${label.name}`,
            {
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            }
          );

          const messagesData = await messagesResponse.json();
          const messages = messagesData.messages || [];

          if (messages.length > 0) {
            console.log(
              `Found ${messages.length} emails for label "${label.name}". Processing emails.`
            );

            // Remove label from emails
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
              console.error(
                `Failed to remove label from emails for label ${label.name}: ${batchModifyResponse.statusText}`
              );
              messageDiv.textContent = `Failed to remove label from emails for label: ${label.name}`;
            } else {
              console.log(
                `Removed label "${label.name}" from ${emailIds.length} emails.`
              );
            }
          }

          // Delete the label
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
            const errorDetails = await deleteLabelResponse.json();
            console.error(
              `Failed to delete label ${label.name}: ${deleteLabelResponse.statusText}`,
              errorDetails
            );
            failedLabels.push(label.name);
          } else {
            console.log(`Deleted label: ${label.name}`);
            processedLabels.push(label.name);
            messageDiv.textContent = `Deleted label: ${label.name}`;
          }
        } catch (labelError) {
          console.error(`Error processing label ${label.name}:`, labelError);
          failedLabels.push(label.name);
        }
      }

      // Final summary
      //       messageDiv.textContent = `Processing of labels completed.
      //   Processed labels: ${processedLabels.join(", ")}
      //   ${
      //     failedLabels.length > 0
      //       ? `Failed to process labels: ${failedLabels.join(", ")}`
      //       : ""
      //   }`;
      messageDiv.textContent = `Processing of labels completed`;
      console.log("Processing of labels completed.");
    } catch (error) {
      console.error("Error in clearAll:", error);
      messageDiv.textContent = `Error in clearAll: ${error.message}`;
    }
  }

  clearLabelsButton.addEventListener("click", () => {
    clearProcessedEmailIds();
    clearAll(authToken, 10, 20);
  });

  clearAllButton.addEventListener("click", () => {
    clearProcessedEmailIds();
    clearAll(authToken, 250, 100);
  });

  initializeAuth();
  //   getEmail();
  //   getEmailDetails("19383d049a73ada7");
});
