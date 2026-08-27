import { predefinedLabels, FALLBACK_LABEL, buildLabelPrompt } from "./labels.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function suggestLabelOpenAI(subject, body, { openaiApiKey, openaiModel }) {
  if (!openaiApiKey) {
    throw new Error(
      "No OpenAI API key configured. Open the extension's Settings page and add one."
    );
  }

  const prompt = buildLabelPrompt(subject, body);

  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
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
        }
      );

      if (response.ok) {
        const data = await response.json();
        const label = data.choices[0].message.content.trim();

        if (predefinedLabels.includes(label)) {
          return label;
        } else {
          console.warn("Unexpected label received, defaulting to fallback");
          return FALLBACK_LABEL;
        }
      } else if (response.status === 401) {
        throw new Error(
          "OpenAI rejected the API key (401). Check the key in Settings."
        );
      } else if (response.status === 429) {
        console.warn("Rate limit exceeded. Retrying...");
        const retryAfter =
          parseInt(response.headers.get("Retry-After"), 10) || 1000;
        await delay(retryAfter);
        retryCount++;
      } else {
        throw new Error(`OpenAI API Error: ${response.statusText}`);
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
