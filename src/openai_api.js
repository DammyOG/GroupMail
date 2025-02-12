import { OPENAI_API_KEY } from "./config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Expanded predefined labels for more precise categorization
const predefinedLabels = [
  "Work",
  "Personal",
  "Family",
  "Friends",
  "Finance",
  "Banking",
  "Bills",
  "Investments",
  "Job Applications",
  "Taxes",
  "Shopping",
  "Receipts",
  "Promotions",
  "Coupons",
  "Newsletters",
  "Social Media",
  "LinkedIn",
  "Twitter",
  "Facebook",
  "Travel",
  "Flights",
  "Hotels",
  "Car Rentals",
  "Healthcare",
  "Medical Bills",
  "Appointments",
  "Insurance",
  "Subscriptions",
  "Entertainment",
  "Movies",
  "Music",
  "Streaming Services",
  "Online Courses",
  "Education",
  "School",
  "University",
  "Tech",
  "Software Updates",
  "Security Alerts",
  "Customer Support",
  "Spam",
  "Scam Alerts",
  "Important",
  "To-Do",
  "Follow-Up",
  "Events",
  "Meetings",
  "Deadlines",
  "Updates",
  "Random",
];

export async function suggestLabel(subject, body) {
  const prompt = `
      Here is an email:
      Subject: ${subject}
      Body: ${body}
      
      Based on the content, select the **most appropriate** label from this predefined list:
      ${predefinedLabels.join(", ")}.

      Only respond with a single label from the list. Do not generate new labels.
    `;

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
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 10,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const label = data.choices[0].message.content.trim();

        // Ensure the response is a valid label from our predefined list
        if (predefinedLabels.includes(label)) {
          return label;
        } else {
          console.warn("Unexpected label received, defaulting to 'Updates'");
          return "Updates"; // Default fallback label
        }
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
