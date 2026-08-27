import { getSettings, saveSettings } from "./src/storage.js";
import { BUILD_ID } from "./src/buildId.js";
import { getProcessedEmailIds, clearProcessedEmailIds } from "./src/processedIds.js";

const form = document.getElementById("settings-form");
const providerSelect = document.getElementById("provider");
const openaiApiKeyInput = document.getElementById("openai-api-key");
const openaiModelSelect = document.getElementById("openai-model");
const anthropicApiKeyInput = document.getElementById("anthropic-api-key");
const anthropicModelSelect = document.getElementById("anthropic-model");
const anthropicWorkspaceIdInput = document.getElementById("anthropic-workspace-id");
const status = document.getElementById("status");

const staleWorkerBanner = document.getElementById("stale-worker");
const resetButton = document.getElementById("reset-tracking");

// This page is read from disk every time it opens; the background service
// worker is not. When they disagree, changes made here silently have no
// effect on labeling, which looks exactly like the fix not working.
function checkWorkerIsCurrent() {
  chrome.runtime.sendMessage({ type: "GET_BUILD_ID" }, (response) => {
    // A worker too old to know this message type answers nothing, which
    // sets lastError — that is itself the stale signal.
    const workerBuild = chrome.runtime.lastError ? null : response?.buildId;
    if (workerBuild === BUILD_ID) return;

    staleWorkerBanner.hidden = false;
    staleWorkerBanner.textContent =
      `The background worker is running older code (${workerBuild || "pre-2026-08-27.5"}) ` +
      `than this page (${BUILD_ID}), so changes saved here will not affect labeling. ` +
      `Open chrome://extensions and click Reload on Gmail Group, then reopen Settings.`;
  });
}
const resetStatus = document.getElementById("reset-status");

async function load() {
  const settings = await getSettings();
  providerSelect.value = settings.provider;
  openaiApiKeyInput.value = settings.openaiApiKey || "";
  openaiModelSelect.value = settings.openaiModel;
  anthropicApiKeyInput.value = settings.anthropicApiKey || "";
  anthropicModelSelect.value = settings.anthropicModel;
  anthropicWorkspaceIdInput.value = settings.anthropicWorkspaceId || "";
  await refreshResetStatus();
}

async function refreshResetStatus() {
  const ids = await getProcessedEmailIds();
  resetStatus.textContent = `Currently tracking ${ids.size} email(s) as already grouped.`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings({
    provider: providerSelect.value,
    openaiApiKey: openaiApiKeyInput.value.trim(),
    openaiModel: openaiModelSelect.value,
    anthropicApiKey: anthropicApiKeyInput.value.trim(),
    anthropicModel: anthropicModelSelect.value,
    anthropicWorkspaceId: anthropicWorkspaceIdInput.value.trim(),
  });
  // Any previous "fix your settings" verdict was about the old
  // configuration. Leaving it in place makes the popup keep replaying an
  // error the user has just addressed.
  await new Promise((resolve) => chrome.storage.local.remove("jobStatus", resolve));

  status.textContent = "Settings saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

resetButton.addEventListener("click", async () => {
  await clearProcessedEmailIds();
  await refreshResetStatus();
  const original = resetStatus.textContent;
  resetStatus.textContent = "Tracking reset. " + original;
});

checkWorkerIsCurrent();
load();
