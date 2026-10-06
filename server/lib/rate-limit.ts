// How long to wait before retrying a failed AI call

export interface RateLimitInfo {
  isRateLimited: boolean;
  retryAfterMs: number | null;
  statusCode?: number;
}

export function detectRateLimit(error: unknown): RateLimitInfo {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('429') || message.includes('rate limit') || message.includes('quota') || message.includes('too many requests')) {
      // Use the wait Google asks for ("retryDelay":"23s") when it gives one;
      // most 429s are short capacity blips, so otherwise retry after 15s
      const googleDelay = error.message.match(/retry ?delay"?[:\s"]*(\d+(?:\.\d+)?)s/i);
      const retryAfter = message.match(/retry.?after[:\s]*(\d+)/i);
      const retryAfterMs = googleDelay ? Math.ceil(parseFloat(googleDelay[1]) * 1000) : retryAfter ? parseInt(retryAfter[1]) * 1000 : 15000;
      return { isRateLimited: true, retryAfterMs: Math.min(retryAfterMs, 60000), statusCode: 429 };
    }
    if (/\b(500|502|503|504)\b|service unavailable|internal error/.test(message)) {
      return { isRateLimited: true, retryAfterMs: 5000, statusCode: 503 };
    }
  }
  return { isRateLimited: false, retryAfterMs: null };
}
