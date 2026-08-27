// Single source of truth for which email IDs have already been labeled,
// shared by both popup.js and background.js so the two flows can't drift
// out of sync with each other.

export async function getProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.get("processedEmailIds", (result) => {
      resolve(result.processedEmailIds || []);
    });
  });
}

export async function addProcessedEmailId(id) {
  return addProcessedEmailIds([id]);
}

// Batch form: takes one read-modify-write round trip for a whole group of
// IDs instead of one per ID, which also avoids the lost-update race that
// happens when several addProcessedEmailId() calls run concurrently.
export async function addProcessedEmailIds(ids) {
  if (ids.length === 0) return;
  const processedIds = await getProcessedEmailIds();
  const merged = Array.from(new Set([...processedIds, ...ids]));
  return new Promise((resolve) => {
    chrome.storage.local.set({ processedEmailIds: merged }, resolve);
  });
}

export async function clearProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.remove("processedEmailIds", resolve);
  });
}
