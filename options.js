import { getSettings, saveSettings } from "./src/storage.js";
import { getProcessedEmailIds, clearProcessedEmailIds } from "./src/processedIds.js";

const form = document.getElementById("settings-form");
const providerSelect = document.getElementById("provider");
const openaiApiKeyInput = document.getElementById("openai-api-key");
const openaiModelSelect = document.getElementById("openai-model");
const anthropicApiKeyInput = document.getElementById("anthropic-api-key");
const anthropicModelSelect = document.getElementById("anthropic-model");
const anthropicWorkspaceIdInput = document.getElementById("anthropic-workspace-id");
const status = document.getElementById("status");

const resetButton = document.getElementById("reset-tracking");
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

load();
