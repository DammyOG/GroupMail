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
  const processedIds = await getProcessedEmailIds();
  processedIds.push(id);
  return new Promise((resolve) => {
    chrome.storage.local.set({ processedEmailIds: processedIds }, resolve);
  });
}

export async function clearProcessedEmailIds() {
  return new Promise((resolve) => {
    chrome.storage.local.remove("processedEmailIds", resolve);
  });
}
