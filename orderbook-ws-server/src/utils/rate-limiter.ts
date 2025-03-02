/**
 * A simple rate limiter for WebSocket connections and messages
 * Uses the token bucket algorithm to control request rates
 */
export class RateLimiter {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();
  
  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number, // tokens per second
    private readonly refillInterval: number = 1000 // ms
  ) {}
  
  /**
   * Checks if an action is allowed based on the key's current rate limit
   * @param key The unique identifier (e.g., IP address, client ID)
   * @returns True if the action is allowed, false if rate limited
   */
  public allowRequest(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    
    // Initialize bucket if it doesn't exist
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now
      };
      this.buckets.set(key, bucket);
      return true;
    }
    
    // Refill tokens based on time elapsed
    const timeElapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((timeElapsed / this.refillInterval) * this.refillRate);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
    
    // Check if there are tokens available
    if (bucket.tokens > 0) {
      bucket.tokens -= 1;
      return true;
    }
    
    return false;
  }
  
  /**
   * Get the number of tokens remaining for a key
   * @param key The unique identifier
   * @returns The number of tokens available, or maxTokens if the key doesn't exist
   */
  public getTokensRemaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return this.maxTokens;
    }
    
    // Refill tokens based on time elapsed before returning
    const now = Date.now();
    const timeElapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((timeElapsed / this.refillInterval) * this.refillRate);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
    
    return bucket.tokens;
  }
  
  /**
   * Reset the rate limiter for a specific key
   * @param key The unique identifier
   */
  public reset(key: string): void {
    this.buckets.delete(key);
  }
  
  /**
   * Clear all rate limiting data (useful for tests or server resets)
   */
  public clearAll(): void {
    this.buckets.clear();
  }
} 