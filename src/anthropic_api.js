import { predefinedLabels, FALLBACK_LABEL, buildLabelPrompt } from "./labels.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function suggestLabelAnthropic(subject, body, { anthropicApiKey, anthropicModel }) {
  if (!anthropicApiKey) {
    throw new Error(
      "No Anthropic API key configured. Open the extension's Settings page and add one."
    );
  }

  const prompt = buildLabelPrompt(subject, body);

  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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

      if (response.ok) {
        const data = await response.json();
        const label = data.content?.[0]?.text?.trim();

        if (predefinedLabels.includes(label)) {
          return label;
        } else {
          console.warn("Unexpected label received, defaulting to fallback");
          return FALLBACK_LABEL;
        }
      } else if (response.status === 401) {
        throw new Error(
          "Anthropic rejected the API key (401). Check the key in Settings."
        );
      } else if (response.status === 429) {
        console.warn("Rate limit exceeded. Retrying...");
        const retryAfter =
          parseInt(response.headers.get("retry-after"), 10) || 1000;
        await delay(retryAfter);
        retryCount++;
      } else {
        const errorBody = await response.text();
        throw new Error(`Anthropic API Error: ${response.statusText} - ${errorBody}`);
      }
    } catch (error) {
      if (retryCount === maxRetries) {
        console.error("Max retries reached. Failing...");
        throw error;
      }
      console.warn("Retrying after error:", error);
      await delay(1000);
      retryCount++;
    }
  }

  throw new Error("Failed to process request after retries.");
}
