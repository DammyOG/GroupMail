# Group Mail

A Chrome extension (Manifest V3) that automatically organizes your Gmail
inbox by applying AI-suggested labels, using OpenAI's or Anthropic's API
and the Gmail API. It also polls in the background every 15 minutes so new
mail gets labeled without you opening the popup.

## ✨ Features

- **AI-powered labeling** — picks the best-fit label for each email from a
  built-in list of ~50 categories (Work, Finance, Travel, Newsletters, etc.).
- **Choose what to label** — the popup's *Scope* control covers unread mail
  only or your whole inbox (read included), and *Go back N emails* sets how
  far into the backlog a run reaches (up to 2000).
- **Background auto-labeling** — polls unread mail every 15 minutes.
- **Label cleanup** — "Clear Labels" / "Clear All" remove labels this
  extension created, without touching Gmail's built-in system labels.
- **No secrets in the repo** — your OpenAI API key is entered through the
  extension's own Settings page and stored in `chrome.storage`, never
  written to a file that could be committed.

## 🚀 Setup

This extension needs two things you must provide yourself: a **Google OAuth
client ID** for Gmail access, and an **OpenAI API key** for labeling. Neither
can be shipped in the repo — OAuth client IDs are bound to a specific
extension ID, and API keys are secrets.

### 1. Load the unpacked extension (to get your extension ID)

1. Go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this project folder.
4. Copy the **ID** Chrome shows for the extension (a long string of
   letters) — you'll need it in the next step.

The extension will fail to sign in at this point — that's expected, it
still needs its own OAuth client ID.

### 2. Create a Google OAuth client ID

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   and create a new project (or reuse one).
2. Under **APIs & Services → Library**, enable the **Gmail API** and the
   **People API**.
3. Under **APIs & Services → OAuth consent screen**, configure it as
   **External**, add your own Google account as a **test user**, and add
   these scopes: `.../auth/userinfo.profile`, `.../auth/gmail.labels`,
   `.../auth/gmail.modify`.
4. Under **APIs & Services → Credentials**, click **Create Credentials →
   OAuth client ID**, choose application type **Chrome Extension**, and
   paste in the extension ID you copied in step 1.
5. Copy the generated **Client ID**.

### 3. Wire the client ID into the extension

Open `manifest.json` and replace the placeholder:

```json
"client_id": "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

with the client ID from step 2. Then go back to `chrome://extensions/` and
click the reload icon on the extension.

### 4. Add an API key

The extension can classify emails using either OpenAI or Anthropic
(Claude) — pick whichever you have an account for.

1. Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   (OpenAI) or [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   (Anthropic). Note: an Anthropic API key is separate from a claude.ai
   chat subscription and billed separately, even if you already pay for
   Claude Pro/Max.
2. Click the extension icon, then click **Settings**.
3. Pick a provider from the dropdown, paste the matching key, and click
   **Save**. Both providers' keys can be saved at once — switching the
   dropdown later doesn't require re-entering anything.

Both providers are cheap for this kind of short classification task
(a fraction of a cent per email with the default models,
`gpt-4o-mini` / `claude-haiku-4-5`), but neither is free — both require
a payment method on the account before the API will work at all.

### 5. Use it

- Click the extension icon and **Sign-in** with the Google account you
  added as a test user.
- Pick a **Scope** ("Unread only" or "Inbox (read + unread)") and how many
  emails to **go back**, then click **Group Emails**. Both choices are
  remembered for next time.
- Emails already labeled by a previous run are skipped, so raising the
  count later only pays for the new ones.
- After that, newly-arrived *unread* mail is labeled automatically every 15
  minutes in the background — no need to keep the popup open. The
  background poll is always unread-only regardless of the scope you pick
  for manual runs.
- **Clear Labels** removes labels from a small batch (useful for testing);
  **Clear All** removes labels from everything this extension has created.

## 🛠 Tech Stack

- Vanilla JavaScript (ES modules), no build step
- Chrome Extension Manifest V3 (`chrome.identity`, `chrome.storage`, `chrome.alarms`)
- Gmail API + Google People API
- OpenAI Chat Completions API or Anthropic Messages API (your choice)

## 🔒 Notes on data & privacy

- Only the sender, subject, and Gmail's own ~200-character snippet are
  sent to whichever provider you've selected, to pick a label. Full message
  bodies are never fetched or transmitted.
- Which emails are looked at is entirely up to the Scope you choose;
  archived mail, Sent and Trash are never touched.
- Your API key(s) live in `chrome.storage.sync` (tied to your Chrome
  profile) and are sent only to that provider's own API.
- This is intended for personal/single-user use — the OAuth consent screen
  stays in "Testing" mode, limited to accounts you explicitly add as test
  users.

## 🩹 Troubleshooting

- **"All emails are already grouped" but Gmail shows no labels**: the
  extension tracks which email IDs it has already processed locally, and
  that tracking can drift out of sync with Gmail's real state (e.g. after
  testing, or if a job was interrupted oddly). Open **Settings → Reset
  tracked emails** to clear that memory and force a fresh pass.
- **Nothing gets labeled at all / Clear Labels does nothing visible**:
  open `chrome://extensions/`, find this extension, click **service
  worker** to open its console, and check for errors there — that's
  where actual failures (auth, API, permissions) get logged.
- **Read emails aren't being labeled**: the default scope is "Unread only".
  Switch the popup's *Scope* to "Inbox (read + unread)" and raise *Go back*
  before clicking Group Emails.
- **"identity-linked API key" error from Anthropic**: your key isn't
  scoped to a single workspace, so Anthropic needs to be told which one
  to bill. Open **Settings**, paste the `wrkspc_...` value into
  **Workspace ID**, and save. Find it in the Console under Settings
  &rarr; Workspaces. Leave the field blank for ordinary
  workspace-scoped keys.
- **`Failed to create label "X"` in the worker console**: Gmail reserves
  certain label names (Spam, Important, Inbox, Trash, Starred, Sent,
  Draft, Unread, Chat) and refuses to create a user label using one. The
  taxonomy avoids these, and anything else Gmail rejects falls back to
  the `Updates` label rather than losing the email.
- **"bad client id" on sign-in**: your OAuth client ID (step 2/3 above)
  doesn't match this extension's current ID — reload the unpacked
  extension, confirm the ID, and re-check the client in Google Cloud
  Console.

## 📜 License

MIT License
