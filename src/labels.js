// Shared between whichever AI provider is active (OpenAI or Anthropic) so
// both classify against the exact same label taxonomy and prompt.

export const predefinedLabels = [
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

export const FALLBACK_LABEL = "Updates";

export function buildLabelPrompt(subject, body) {
  return `
      Here is an email:
      Subject: ${subject}
      Body: ${body}

      Based on the content, select the **most appropriate** label from this predefined list:
      ${predefinedLabels.join(", ")}.

      Only respond with a single label from the list. Do not generate new labels.
    `;
}
