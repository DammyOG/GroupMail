// Bump this whenever a change needs to reach the background service
// worker.
//
// Chrome keeps a registered service worker alive across file edits to an
// unpacked extension, while extension *pages* (popup, options) are read
// fresh from disk each time they open. So the Settings page can be
// running new code while the worker is still on old code — with no
// visible sign, and every symptom looking like the fix didn't work.
//
// The Settings page asks the worker for its BUILD_ID and compares it
// against its own, turning that invisible mismatch into a banner.
export const BUILD_ID = "2026-08-27.4";
