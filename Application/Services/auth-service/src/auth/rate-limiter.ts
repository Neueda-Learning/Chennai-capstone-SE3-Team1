interface Record {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

export class LoginRateLimiter {
  private attempts = new Map<string, Record>();
  private readonly MAX = 5;
  private readonly WINDOW_MS = 15 * 60 * 1000;
  private readonly LOCKOUT_MS = 15 * 60 * 1000;

  check(username: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const rec = this.attempts.get(username);
    if (!rec) return { allowed: true };
    if (now - rec.firstAttempt > this.WINDOW_MS) {
      this.attempts.delete(username);
      return { allowed: true };
    }
    if (rec.lockedUntil && now < rec.lockedUntil) {
      return { allowed: false, retryAfterMs: rec.lockedUntil - now };
    }
    if (rec.count >= this.MAX) {
      rec.lockedUntil = now + this.LOCKOUT_MS;
      return { allowed: false, retryAfterMs: this.LOCKOUT_MS };
    }
    return { allowed: true };
  }

  recordSuccess(username: string) {
    this.attempts.delete(username);
  }
  recordFailure(username: string) {
    const now = Date.now();
    const rec = this.attempts.get(username) || { count: 0, firstAttempt: now };
    rec.count++;
    this.attempts.set(username, rec);
  }
}
