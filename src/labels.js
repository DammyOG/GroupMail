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
  "Junk",
  "Scam Alerts",
  "Priority",
  "To-Do",
  "Follow-Up",
  "Events",
  "Meetings",
  "Deadlines",
  "Updates",
  "Random",
];

export const FALLBACK_LABEL = "Updates";

// Case-insensitive lookup so a model answering "work" or "Work." still
// lands on the real label instead of silently falling back to Updates.
const labelsByLowercaseName = new Map(
  predefinedLabels.map((label) => [label.toLowerCase(), label])
);

// Returns the canonical label, or null if the model answered with
// something genuinely off-list.
export function normalizeLabel(rawLabel) {
  if (!rawLabel) return null;

  const cleaned = rawLabel.trim().replace(/^["'`]+|["'`.\s]+$/g, "");
  return labelsByLowercaseName.get(cleaned.toLowerCase()) || null;
}

// Sender is the single strongest signal for most of these categories
// (a bank, an airline, a recruiter), so it goes first in the prompt.
export function buildLabelPrompt({ from, subject, snippet }) {
  return `Email:
From: ${from}
Subject: ${subject}
Preview: ${snippet}

Choose the single most appropriate label from this list:
${predefinedLabels.join(", ")}

Respond with the label only. Do not explain, and do not invent new labels.`;
}
