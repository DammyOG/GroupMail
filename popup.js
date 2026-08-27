import { getGmailService, clearToken, fetchUserProfile } from "./src/gmail_api.js";
import {
  SCOPES,
  MAX_LIMIT,
  getJobOptions,
  saveJobOptions,
  normalizeLimit,
} from "./src/jobOptions.js";

document.addEventListener("DOMContentLoaded", () => {
  const signInButton = document.getElementById("sign-in");
  const signOutButton = document.getElementById("sign-out");
  const settingsButton = document.getElementById("settings");
  const messageDiv = document.getElementById("message");
  const groupEmailsButton = document.getElementById("group-emails");
  const clearLabelsButton = document.getElementById("clear-labels");
  const clearAllButton = document.getElementById("clear-all");
  const jobOptionsPanel = document.getElementById("job-options");
  const scopeSelect = document.getElementById("scope");
  const limitInput = document.getElementById("limit");

  let signedIn = false;

  for (const [value, { label }] of Object.entries(SCOPES)) {
    scopeSelect.add(new Option(label, value));
  }
  limitInput.max = MAX_LIMIT;

  // Reopen the popup showing whatever the user chose last time.
  getJobOptions().then(({ scope, limit }) => {
    scopeSelect.value = scope;
    limitInput.value = limit;
  });

  settingsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  function showOpenSettingsPrompt(text) {
    messageDiv.innerHTML = `<p>${text}</p><button id="open-settings-inline">Open Settings</button>`;
    document
      .getElementById("open-settings-inline")
      .addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  function setButtonsEnabled(enabled) {
    groupEmailsButton.disabled = !enabled;
    clearLabelsButton.disabled = !enabled;
    clearAllButton.disabled = !enabled;
    scopeSelect.disabled = !enabled;
    limitInput.disabled = !enabled;
  }

  // The actual work runs in the background service worker (background.js)
  // so it keeps going even if this popup loses focus and gets torn down.
  // This just reflects whatever the background worker last reported.
  function renderJobStatus(status) {
    if (!status) return;

    if (status.needsSettings) {
      showOpenSettingsPrompt(status.message);
      setButtonsEnabled(true);
      return;
    }

    if (status.running) {
      const progress = status.total ? ` (${status.current}/${status.total})` : "";
      messageDiv.textContent = `${status.message}${progress}`;
      setButtonsEnabled(false);
    } else {
      messageDiv.textContent = status.message;
      setButtonsEnabled(true);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.jobStatus && signedIn) {
      renderJobStatus(changes.jobStatus.newValue);
    }
  });

  async function signIn() {
    try {
      const authToken = await getGmailService(true);
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
      signedIn = false;
      signInButton.style.display = "block";
      jobOptionsPanel.style.display = "none";
      groupEmailsButton.style.display = "none";
      clearLabelsButton.style.display = "none";
      clearAllButton.style.display = "none";
      signOutButton.style.display = "none";
      messageDiv.textContent = "";
      document.body.style.justifyContent = "center";
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  signOutButton.addEventListener("click", signOut);

  async function startGrouping() {
    const scope = scopeSelect.value;
    // Snap the field to the value actually being used, so an out-of-range
    // entry doesn't look like it was honoured.
    const limit = normalizeLimit(limitInput.value);
    limitInput.value = limit;

    messageDiv.textContent = "Starting...";
    setButtonsEnabled(false);
    await saveJobOptions({ scope, limit });
    chrome.runtime.sendMessage({ type: "START_GROUPING", scope, limit });
  }

  function startClear(maxLabelsToClear, maxEmailsPerLabel) {
    messageDiv.textContent = "Starting...";
    setButtonsEnabled(false);
    chrome.runtime.sendMessage({ type: "CLEAR_LABELS", maxLabelsToClear, maxEmailsPerLabel });
  }

  groupEmailsButton.addEventListener("click", startGrouping);
  clearLabelsButton.addEventListener("click", () => startClear(10, 20));
  clearAllButton.addEventListener("click", () => startClear(250, 100));

  async function initializeAuth() {
    try {
      const authToken = await getGmailService(false);
      const firstName = await fetchUserProfile(authToken);
      updateUiAfterSignIn(firstName);
    } catch (error) {
      console.log(error.message);
      signInButton.disabled = false;
      signOutButton.disabled = true;
    }
  }

  function updateUiAfterSignIn(firstName) {
    signedIn = true;
    messageDiv.textContent = `Welcome, ${firstName}! Click "Group Emails" to get started.`;

    document.body.style.justifyContent = "space-between";

    signInButton.style.display = "none";
    signOutButton.style.display = "block";
    jobOptionsPanel.style.display = "grid";
    groupEmailsButton.style.display = "block";
    clearLabelsButton.style.display = "block";
    clearAllButton.style.display = "block";

    // Reflect a job that may already be running (e.g. started before the
    // popup was last closed and reopened).
    chrome.storage.local.get("jobStatus", (result) => {
      if (result.jobStatus) renderJobStatus(result.jobStatus);
    });
  }

  initializeAuth();
});
