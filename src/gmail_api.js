import { suggestLabel } from "./openai_api.js";

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

export async function getEmails(authToken) {
  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=50",
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

export async function getEmailDetails(authToken, id) {
  const response = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  if (!response.ok) throw new Error("Failed to fetch email details");

  const message = await response.json();

  const headers = message.payload.headers || [];
  const subject =
    headers.find((header) => header.name === "Subject")?.value || "No Subject";

  const plainTextPart = message.payload.parts?.find(
    (part) => part.mimeType === "text/plain"
  );

  const htmlPart = message.payload.parts?.find(
    (part) => part.mimeType === "text/html"
  );

  const body = plainTextPart
    ? atob(plainTextPart.body.data.replace(/-/g, "+").replace(/_/g, "/"))
    : htmlPart
    ? atob(htmlPart.body.data.replace(/-/g, "+").replace(/_/g, "/"))
    : "No Content";

  const truncatedBody =
    body.length > 1000 ? `${body.substring(0, 1000)}...` : body;

  return { subject, body: truncatedBody };
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
    const error = await createResponse.json();
    console.error("Failed to create label:", error);
    throw new Error(`Failed to create label: ${createResponse.statusText}`);
  }

  return createResponse.json();
}

export async function addLabelToEmail(authToken, emailId, labelId) {
  const response = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLabelIds: [labelId], // Label to add
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    console.error("Error modifying email:", error);
    throw new Error(
      `Failed to add label to email ${emailId}: ${response.statusText}`
    );
  }
}
