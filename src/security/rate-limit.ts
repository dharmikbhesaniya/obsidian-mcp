import { ErrorCode, ObsidianMcpError } from "../schemas/errors.js";

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private readonly maxRequestsPerMinute: number;
  private readonly buckets: Map<string, RateLimitBucket> = new Map();

  constructor(maxRequestsPerMinute: number = 120) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
  }

  public checkRateLimit(clientId: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = {
        tokens: this.maxRequestsPerMinute,
        lastRefill: now,
      };
      this.buckets.set(clientId, bucket);
    } else {
      // Calculate token refill based on elapsed time (60 seconds for full refill)
      const elapsedMs = now - bucket.lastRefill;
      const refillAmount = (elapsedMs / 60000) * this.maxRequestsPerMinute;
      bucket.tokens = Math.min(this.maxRequestsPerMinute, bucket.tokens + refillAmount);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      const waitSeconds = Math.ceil((1 - bucket.tokens) * (60 / this.maxRequestsPerMinute));
      throw new ObsidianMcpError(
        ErrorCode.RATE_LIMITED,
        `Rate limit exceeded. Maximum ${this.maxRequestsPerMinute} requests per minute.`,
        429,
        { retryAfterSeconds: waitSeconds }
      );
    }

    bucket.tokens -= 1;
  }
}
