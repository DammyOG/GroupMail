export async function getGmailService(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(
          new Error(chrome.runtime.lastError?.message || "User is not signed in.")
        );
      } else {
        resolve(token);
      }
    });
  });
}

export async function getEmails(authToken, query = "is:unread") {
  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages" +
      `?q=${encodeURIComponent(query)}&maxResults=50`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );
  const data = await response.json();
  return data.messages || [];
}

// Clear the cached token
export async function clearToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      if (chrome.runtime.lastError) {
        reject(new Error("Failed to clear token"));
      } else {
        resolve();
      }
    });
  });
}

// Fetch user profile
export async function fetchUserProfile(token) {
  const apiUrl =
    "https://people.googleapis.com/v1/people/me?personFields=names";

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch user profile");
    }

    const data = await response.json();
    const firstName = data.names?.[0]?.givenName || "User";
    return firstName;
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return "User"; // Fallback name if fetch fails
  }
}

// Fetches only what the classifier needs: sender, subject, and Gmail's
// own ~200-char snippet. `format=metadata` skips the base64 message
// bodies and attachment payloads entirely, which is by far the largest
// part of a `format=full` response.
export async function getEmailDetails(authToken, id) {
  const response = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${id}` +
      "?format=metadata&metadataHeaders=Subject&metadataHeaders=From",
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch email ${id}: ${response.statusText}`);
  }

  const message = await response.json();
  const headers = message.payload?.headers || [];

  // Gmail is not guaranteed to preserve header name casing.
  const header = (name) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value?.trim() || "";

  return {
    from: header("from") || "Unknown Sender",
    subject: header("subject") || "No Subject",
    snippet: message.snippet || "",
  };
}

// Fetch the full label list once. Callers that need to resolve many
// label names (a whole batch job) should call this once and cache the
// result instead of re-fetching per email.
export async function listLabels(authToken) {
  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch labels: ${response.statusText}`);
  }

  const data = await response.json();
  return data.labels || [];
}

export async function createLabel(authToken, labelName) {
  const createResponse = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: labelName, // Label name must be unique
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    }
  );

  if (!createResponse.ok) {
    const error = new Error(
      `Failed to create label "${labelName}": ${createResponse.statusText}`
    );
    // Gmail answers 409 when the label already exists — either the user
    // made it by hand or a concurrent job won the race. Callers can
    // recover from that by looking the existing label up.
    error.alreadyExists = createResponse.status === 409;
    throw error;
  }

  return createResponse.json();
}

// Applies one label to many messages in a single request, instead of one
// modify call per email. Gmail caps batchModify at 1000 ids per call and
// returns 204 No Content on success.
export async function addLabelToEmails(authToken, emailIds, labelId) {
  if (emailIds.length === 0) return;

  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages/batchModify",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: emailIds,
        addLabelIds: [labelId],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to label ${emailIds.length} email(s): ${response.statusText}`
    );
  }
}
