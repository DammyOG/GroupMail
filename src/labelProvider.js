import { getSettings } from "./storage.js";
import { suggestLabelOpenAI } from "./openai_api.js";
import { suggestLabelAnthropic } from "./anthropic_api.js";

// `email` is the { from, subject, snippet } shape returned by
// getEmailDetails().
export async function suggestLabel(email) {
  const settings = await getSettings();

  if (settings.provider === "anthropic") {
    return suggestLabelAnthropic(email, settings);
  }

  return suggestLabelOpenAI(email, settings);
}
