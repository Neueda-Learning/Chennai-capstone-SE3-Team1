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

  check(email: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const rec = this.attempts.get(email);
    if (!rec) return { allowed: true };
    if (now - rec.firstAttempt > this.WINDOW_MS) {
      this.attempts.delete(email);
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

  recordSuccess(email: string) {
    this.attempts.delete(email);
  }
  recordFailure(email: string) {
    const now = Date.now();
    const rec = this.attempts.get(email) || { count: 0, firstAttempt: now };
    rec.count++;
    this.attempts.set(email, rec);
  }
}
