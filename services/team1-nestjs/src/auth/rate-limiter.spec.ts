import { LoginRateLimiter } from './rate-limiter';

describe('LoginRateLimiter', () => {
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter();
  });

  it('allows up to 5 attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('alice').allowed).toBe(true);
      limiter.recordFailure('alice');
    }
    expect(limiter.check('alice').allowed).toBe(false);
  });

  it('locks out after 5 failed attempts', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('bob');
    }
    const result = limiter.check('bob');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('resets on success', () => {
    limiter.recordFailure('carol');
    limiter.recordFailure('carol');
    limiter.recordSuccess('carol');
    expect(limiter.check('carol').allowed).toBe(true);
  });

  it('tracks different usernames separately', () => {
    limiter.recordFailure('alice');
    limiter.recordFailure('alice');
    limiter.recordFailure('alice');
    expect(limiter.check('alice').allowed).toBe(true); // only 3 failures
    expect(limiter.check('bob').allowed).toBe(true); // no failures
  });

  it('resets after window expires', () => {
    const limiter2 = new LoginRateLimiter();
    // Manually set old timestamp
    const username = 'olduser';
    // @ts-expect-error - access private for test
    limiter2.attempts.set(username, {
      count: 5,
      firstAttempt: Date.now() - 20 * 60 * 1000,
      lockedUntil: Date.now() + 15 * 60 * 1000,
    });

    expect(limiter2.check(username).allowed).toBe(true);
  });
});
