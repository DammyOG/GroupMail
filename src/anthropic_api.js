import {
  FALLBACK_LABEL,
  buildLabelPrompt,
  normalizeLabel,
} from "./labels.js";
import { NonRetryableError, RetryableError, withRetries } from "./retry.js";

export async function suggestLabelAnthropic(email, { anthropicApiKey, anthropicModel }) {
  if (!anthropicApiKey) {
    throw new NonRetryableError(
      "No Anthropic API key configured. Open the extension's Settings page and add one."
    );
  }

  const prompt = buildLabelPrompt(email);

  const rawLabel = await withRetries(async () => {
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          // Extension pages call this API directly from the browser (no
          // build step / server to proxy through), which Anthropic
          // otherwise blocks via CORS.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: anthropicModel || "claude-haiku-4-5",
          max_tokens: 10,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (networkError) {
      throw new RetryableError(`Network error reaching Anthropic: ${networkError.message}`);
    }

    if (response.ok) {
      const data = await response.json();
      return data.content?.[0]?.text;
    }

    if (response.status === 401 || response.status === 403) {
      throw new NonRetryableError(
        "Anthropic rejected the API key (401/403). Check the key in Settings."
      );
    }

    if (response.status === 400) {
      throw new NonRetryableError(
        `Anthropic rejected the request: ${await response.text()}`
      );
    }

    if (response.status === 429) {
      // Retry-After is in seconds per the HTTP spec.
      const retryAfterSeconds = parseInt(response.headers.get("retry-after"), 10);
      throw new RetryableError(
        "Anthropic rate limit hit.",
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : undefined
      );
    }

    throw new RetryableError(`Anthropic API error ${response.status}: ${response.statusText}`);
  });

  const label = normalizeLabel(rawLabel);
  if (!label) {
    console.warn(`Off-list label from Anthropic: ${JSON.stringify(rawLabel)}`);
    return FALLBACK_LABEL;
  }

  return label;
}
