import { getSettings } from "./storage.js";
import { suggestLabelOpenAI } from "./openai_api.js";
import { suggestLabelAnthropic } from "./anthropic_api.js";

export async function suggestLabel(subject, body) {
  const settings = await getSettings();

  if (settings.provider === "anthropic") {
    return suggestLabelAnthropic(subject, body, settings);
  }

  return suggestLabelOpenAI(subject, body, settings);
}
