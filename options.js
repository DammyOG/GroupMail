import { getSettings, saveSettings } from "./src/storage.js";

const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const status = document.getElementById("status");

async function load() {
  const { openaiApiKey, model } = await getSettings();
  apiKeyInput.value = openaiApiKey || "";
  modelSelect.value = model || "gpt-4o-mini";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings({
    openaiApiKey: apiKeyInput.value.trim(),
    model: modelSelect.value,
  });
  status.textContent = "Settings saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

load();
