import { suggestLabel } from "./openai_api.js";

export async function getGmailService() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error("User is not signed in."));
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

// Display categorized emails
export async function displayCategorizedEmails(
  emails,
  emailResults,
  messageDiv
) {
  emailResults.textContent = ""; // Clear previous results
  emails.forEach((email) => {
    const emailElement = document.createElement("div");
    emailElement.innerHTML = `
        <p><strong>Subject:</strong> ${email.subject}</p>
        <p><strong>Email:</strong> ${email.body.substring(0, 50)}...</p>
        <strong>Label: ${email.label}</strong>
      `;
    emailResults.appendChild(emailElement);
  });

  messageDiv.textContent = "Emails categorized successfully!";
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

  console.log(subject, truncatedBody);

  return { subject, truncatedBody };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function suggestLabelWithRateLimiting(subject, body) {
  await delay(1000); // Add a delay of 1 second between requests
  return await suggestLabel(subject, body);
}

const RESERVED_LABELS = [
  "INBOX",
  "SPAM",
  "TRASH",
  "IMPORTANT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
];

export async function getOrCreateLabel(authToken, labelName) {
  // Fetch existing labels
  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  const data = await response.json();
  const existingLabel = data.labels?.find((label) => label.name === labelName);

  if (existingLabel) {
    console.log(`Found existing label: ${labelName} (${existingLabel.id})`);
    return existingLabel.id; // Return the ID of the existing label
  }

  // Check if the label name is reserved
  const isReservedLabel = RESERVED_LABELS.includes(labelName.toUpperCase());
  if (isReservedLabel) {
    console.log(`"${labelName}" is a reserved label.`);
    const reservedLabel = data.labels?.find(
      (label) => label.name.toUpperCase() === labelName.toUpperCase()
    );
    if (reservedLabel) {
      return reservedLabel.id; // Return the ID of the reserved label
    } else {
      throw new Error(`Cannot use reserved label name: ${labelName}`);
    }
  }

  // Create a new label
  console.log(`Creating new label: ${labelName}`);
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

  const newLabel = await createResponse.json();
  console.log(`Created new label: ${labelName} (${newLabel.id})`);
  return newLabel.id;
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
