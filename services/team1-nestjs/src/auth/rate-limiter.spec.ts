import { LoginRateLimiter } from './rate-limiter';

describe('LoginRateLimiter', () => {
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter();
  });

  it('allows up to 5 attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('a@b.c').allowed).toBe(true);
      limiter.recordFailure('a@b.c');
    }
    expect(limiter.check('a@b.c').allowed).toBe(false);
  });

  it('locks out after 5 failed attempts', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('x@y.z');
    }
    const result = limiter.check('x@y.z');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('resets on success', () => {
    limiter.recordFailure('x@y.z');
    limiter.recordFailure('x@y.z');
    limiter.recordSuccess('x@y.z');
    expect(limiter.check('x@y.z').allowed).toBe(true);
  });

  it('tracks different emails separately', () => {
    limiter.recordFailure('a@b.c');
    limiter.recordFailure('a@b.c');
    limiter.recordFailure('a@b.c');
    expect(limiter.check('a@b.c').allowed).toBe(true); // only 3 failures
    expect(limiter.check('x@y.z').allowed).toBe(true); // no failures
  });

  it('resets after window expires', () => {
    const limiter2 = new LoginRateLimiter();
    // Manually set old timestamp
    const email = 'old@test.com';
    // @ts-expect-error - access private for test
    limiter2.attempts.set(email, {
      count: 5,
      firstAttempt: Date.now() - 20 * 60 * 1000,
      lockedUntil: Date.now() + 15 * 60 * 1000,
    });

    expect(limiter2.check(email).allowed).toBe(true);
  });
});
