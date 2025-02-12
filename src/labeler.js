import { suggestLabel } from "./openai_api.js";

export async function labelEmails(emails) {
  const labeledEmails = [];
  for (const email of emails) {
    const { id, subject, body } = email;
    const label = await suggestLabel(subject, body);
    labeledEmails.push({ id, subject, label });
  }
  return labeledEmails;
}
