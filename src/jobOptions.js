// What a "Group Emails" run should cover. The popup writes the user's
// choice here and background.js reads it back, so the two can't drift
// apart — and so a job interrupted by a service-worker recycle resumes
// with the same scope it started with.

export const SCOPES = {
  unread: {
    label: "Unread only",
    query: "is:unread in:inbox",
  },
  inbox: {
    label: "Inbox (read + unread)",
    query: "in:inbox",
  },
};

export const DEFAULT_SCOPE = "unread";
export const DEFAULT_LIMIT = 50;

// Gmail's list endpoint will page well past this, but every email past
// the cap is another model call the user pays for. 2000 is roughly
// $2 of Haiku — high enough for a real backlog cleanup, low enough that
// a stray keystroke can't start a five-figure job.
export const MAX_LIMIT = 2000;

export function queryForScope(scope) {
  return (SCOPES[scope] || SCOPES[DEFAULT_SCOPE]).query;
}

// Clamps whatever came from the popup's number input into something safe
// to hand Gmail, so a blank or nonsense value can't widen the job.
export function normalizeLimit(rawLimit) {
  const limit = Math.floor(Number(rawLimit));
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

export function normalizeScope(rawScope) {
  return rawScope in SCOPES ? rawScope : DEFAULT_SCOPE;
}

// Last-used values, so the popup reopens the way the user left it.
export async function getJobOptions() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      { groupingScope: DEFAULT_SCOPE, groupingLimit: DEFAULT_LIMIT },
      (items) =>
        resolve({
          scope: normalizeScope(items.groupingScope),
          limit: normalizeLimit(items.groupingLimit),
        })
    );
  });
}

export async function saveJobOptions({ scope, limit }) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { groupingScope: normalizeScope(scope), groupingLimit: normalizeLimit(limit) },
      resolve
    );
  });
}
