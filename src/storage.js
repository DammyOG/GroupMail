// Extension settings (OpenAI key, model) persisted in chrome.storage.sync.
// Replaces the old dotenv/.env approach, which cannot work inside a
// Chrome extension (there is no Node process/env at runtime).

export const DEFAULT_MODEL = "gpt-4o-mini";

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { openaiApiKey: "", model: DEFAULT_MODEL },
      (items) => resolve(items)
    );
  });
}

export async function saveSettings({ openaiApiKey, model }) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ openaiApiKey, model }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}
