// Extension settings (which AI provider to use, and each provider's key
// and model) persisted in chrome.storage.sync. Replaces the old dotenv/
// .env approach, which cannot work inside a Chrome extension (there is
// no Node process/env at runtime).

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

const DEFAULTS = {
  provider: "openai", // "openai" | "anthropic"
  openaiApiKey: "",
  openaiModel: DEFAULT_OPENAI_MODEL,
  anthropicApiKey: "",
  anthropicModel: DEFAULT_ANTHROPIC_MODEL,
  // Only required for identity-linked keys, which Anthropic rejects
  // unless the request names the workspace it bills to.
  anthropicWorkspaceId: "",
};

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => resolve(items));
  });
}

export function hasActiveProviderKey(settings) {
  return settings.provider === "anthropic"
    ? Boolean(settings.anthropicApiKey)
    : Boolean(settings.openaiApiKey);
}

export async function saveSettings({
  provider,
  openaiApiKey,
  openaiModel,
  anthropicApiKey,
  anthropicModel,
  anthropicWorkspaceId,
}) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        provider,
        openaiApiKey,
        openaiModel,
        anthropicApiKey,
        anthropicModel,
        anthropicWorkspaceId,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      }
    );
  });
}
