// Single source of truth for which email IDs have already been labeled,
// shared by the manual job and the periodic auto-poll so the two flows
// can't drift out of sync with each other.

// The list is only ever used to skip already-labeled mail, so old entries
// stop earning their keep. Capping it keeps the read-modify-write cheap
// and stays well inside chrome.storage.local's quota.
const MAX_REMEMBERED_IDS = 5000;

// Returns a Set — callers filter large batches against this, and array
// .includes() on a few thousand IDs turns that into an O(n*m) scan.
export async function getProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.get("processedEmailIds", (result) => {
      resolve(new Set(result.processedEmailIds || []));
    });
  });
}

// Batch form: one read-modify-write round trip for a whole group of IDs
// instead of one per ID, which also avoids the lost-update race that
// happens when several single-ID writes run concurrently.
export async function addProcessedEmailIds(ids) {
  if (ids.length === 0) return;

  const processedIds = await getProcessedEmailIds();
  for (const id of ids) processedIds.add(id);

  // Newest entries are the ones worth keeping when we trim.
  const merged = Array.from(processedIds).slice(-MAX_REMEMBERED_IDS);

  return new Promise((resolve) => {
    chrome.storage.local.set({ processedEmailIds: merged }, resolve);
  });
}

export async function clearProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.remove("processedEmailIds", resolve);
  });
}
