// Shared retry helper for the AI provider calls. Both providers hit the
// same three failure shapes — a rate limit worth waiting out, a transient
// network/5xx blip worth retrying, and a bad API key that will never
// succeed no matter how many times we ask.

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Thrown for failures where retrying is pointless (bad key, malformed
// request). Retrying a 401 three times just adds seconds to every email
// in the job before surfacing the same error.
export class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NonRetryableError";
  }
}

// Thrown for failures worth another attempt. `retryAfterMs` lets a 429
// handler pass along the server's own Retry-After hint.
export class RetryableError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "RetryableError";
    this.retryAfterMs = retryAfterMs;
  }
}

export async function withRetries(operation, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof NonRetryableError) throw error;

      lastError = error;
      if (attempt === maxAttempts) break;

      // Honour the server's hint when it gave one, otherwise back off.
      await delay(error.retryAfterMs ?? 500 * attempt);
    }
  }

  throw lastError;
}
