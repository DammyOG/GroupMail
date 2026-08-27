import {
  FALLBACK_LABEL,
  buildLabelPrompt,
  normalizeLabel,
} from "./labels.js";
import { NonRetryableError, RetryableError, withRetries } from "./retry.js";

export async function suggestLabelOpenAI(email, { openaiApiKey, openaiModel }) {
  if (!openaiApiKey) {
    throw new NonRetryableError(
      "No OpenAI API key configured. Open the extension's Settings page and add one."
    );
  }

  const prompt = buildLabelPrompt(email);

  const rawLabel = await withRetries(async () => {
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 10,
        }),
      });
    } catch (networkError) {
      throw new RetryableError(`Network error reaching OpenAI: ${networkError.message}`);
    }

    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content;
    }

    if (response.status === 401 || response.status === 403) {
      throw new NonRetryableError(
        "OpenAI rejected the API key (401/403). Check the key in Settings."
      );
    }

    if (response.status === 400) {
      throw new NonRetryableError(
        `OpenAI rejected the request: ${await response.text()}`
      );
    }

    if (response.status === 429) {
      // Retry-After is in seconds per the HTTP spec.
      const retryAfterSeconds = parseInt(response.headers.get("retry-after"), 10);
      throw new RetryableError(
        "OpenAI rate limit hit.",
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : undefined
      );
    }

    throw new RetryableError(`OpenAI API error ${response.status}: ${response.statusText}`);
  });

  const label = normalizeLabel(rawLabel);
  if (!label) {
    console.warn(`Off-list label from OpenAI: ${JSON.stringify(rawLabel)}`);
    return FALLBACK_LABEL;
  }

  return label;
}
