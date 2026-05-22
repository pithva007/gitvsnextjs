/**
 * githubFetch — a lightweight, native-fetch wrapper for the GitHub REST API.
 *
 * Features:
 * - Automatic exponential backoff on rate-limit responses (HTTP 429, or 403
 *   with x-ratelimit-remaining: 0).
 * - Respects GitHub's `retry-after` and `x-ratelimit-reset` headers when
 *   present; falls back to jittered exponential backoff otherwise.
 * - Retries transient network errors (fetch throws) with the same backoff.
 * - Total maximum wait kept below 8 seconds so requests stay within Vercel
 *   Hobby function timeouts (10 s).
 *
 * Usage:
 *   import { githubFetch } from "@/lib/githubFetch";
 *   const res = await githubFetch("https://api.github.com/user", { token });
 *   if (!res.ok) throw new Error(`GitHub error: ${res.status}`);
 *   const data = await res.json();
 */

// Max backoff chain: 500 + 1000 + 2000 + 4000 = 7 500 ms < 8 000 ms cap.
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;
/** Hard ceiling so a misbehaving retry-after header can't blow the timeout. */
const MAX_SINGLE_DELAY_MS = 7_500;
const MAX_TOTAL_RETRY_DELAY_MS = 7_500;

export interface GitHubFetchOptions extends RequestInit {
  /** GitHub personal access token or installation token. */
  token?: string;
}

/**
 * Determine whether the response signals a rate-limit condition.
 */
function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    return remaining === "0";
  }
  return false;
}

/**
 * Calculate the delay requested by GitHub's response headers.
 * Returns 0 if no usable header is found (caller will use exponential backoff).
 */
function getRetryAfterMs(res: Response): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_SINGLE_DELAY_MS);
    }
  }

  const resetAt = res.headers.get("x-ratelimit-reset");
  if (resetAt) {
    const waitMs = parseInt(resetAt, 10) * 1000 - Date.now();
    return Math.min(Math.max(waitMs, 0), MAX_SINGLE_DELAY_MS);
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute jittered exponential backoff for attempt `n` (0-indexed).
 * Stays within MAX_SINGLE_DELAY_MS to protect against Vercel timeouts.
 */
function backoffMs(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 200;
  return Math.min(base + jitter, MAX_SINGLE_DELAY_MS);
}

/**
 * Fetch a GitHub API URL with automatic retry on rate-limit and network errors.
 *
 * On exhausting all retries due to rate-limiting this returns a synthetic 429
 * Response so the caller can handle it uniformly without a thrown exception.
 *
 * On exhausting all retries due to network errors it returns a synthetic 503
 * Response.
 */
export async function githubFetch(
  url: string,
  options: GitHubFetchOptions = {},
): Promise<Response> {
  const { token, ...fetchOptions } = options;

  const headers = new Headers(fetchOptions.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/vnd.github+json");
  }
  if (!headers.has("X-GitHub-Api-Version")) {
    headers.set("X-GitHub-Api-Version", "2022-11-28");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let lastNetworkError: Error | null = null;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...fetchOptions, headers });

      if (isRateLimited(res)) {
        if (attempt === MAX_RETRIES) {
          console.warn(
            `[githubFetch] Rate limited after ${MAX_RETRIES + 1} attempts on ${url}`,
          );
          return new Response(
            JSON.stringify({
              error:
                "GitHub API rate limit exceeded. Please try again later.",
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const serverWait = getRetryAfterMs(res);
        const delay = serverWait > 0 ? serverWait : backoffMs(attempt);

        if (totalDelayMs + delay > MAX_TOTAL_RETRY_DELAY_MS) {
          console.warn(`[githubFetch] Max total retry delay exceeded for ${url}`);
          return new Response(
            JSON.stringify({
              error: "GitHub API rate limit exceeded. Please try again later.",
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        console.warn(
          `[githubFetch] Rate limited on attempt ${attempt + 1}/${MAX_RETRIES + 1}. ` +
            `Retrying in ${Math.round(delay)}ms… (${url})`,
        );
        totalDelayMs += delay;
        await sleep(delay);
        continue;
      }

      // Non-rate-limit response (success or other HTTP error) — return as-is.
      return res;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw err;
      }

      lastNetworkError =
        err instanceof Error ? err : new Error(String(err));

      if (attempt === MAX_RETRIES) break;

      const delay = backoffMs(attempt);
      if (totalDelayMs + delay > MAX_TOTAL_RETRY_DELAY_MS) {
        break;
      }

      console.warn(
        `[githubFetch] Network error on attempt ${attempt + 1}/${MAX_RETRIES + 1}: ` +
          `${lastNetworkError.message}. Retrying in ${Math.round(delay)}ms… (${url})`,
      );
      totalDelayMs += delay;
      await sleep(delay);
    }
  }

  // All retries exhausted due to network errors.
  const errMsg =
    lastNetworkError?.message ?? "GitHub API request failed after retries.";
  console.error(`[githubFetch] All retries exhausted for ${url}: ${errMsg}`);
  return new Response(JSON.stringify({ error: errMsg }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}
