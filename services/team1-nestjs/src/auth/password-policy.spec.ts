import { PasswordPolicy } from './password-policy';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();

  it('rejects short passwords (< 12 chars)', () => {
    expect(policy.evaluate('Short1!').valid).toBe(false);
    expect(policy.evaluate('Short1!').errors).toContain(
      'Password must be at least 12 characters',
    );
  });

  it('rejects very long passwords (> 128 chars)', () => {
    const p = 'a'.repeat(129);
    expect(policy.evaluate(p).valid).toBe(false);
    expect(policy.evaluate(p).errors).toContain(
      'Password must be at most 128 characters',
    );
  });

  it('accepts passwords without upper/lower/number/symbol requirements (length-first)', () => {
    // 12+ lower-case only must pass: length beats character-class rules per the contract.
    expect(policy.evaluate('twelvecharlower').valid).toBe(true);
    expect(policy.evaluate('ALLUPPERLENGTH12').valid).toBe(true);
  });

  it('rejects containing "password"', () => {
    const p = 'Password1234!x';
    expect(policy.evaluate(p).valid).toBe(false);
    expect(policy.evaluate(p).errors).toContain(
      'Password cannot contain "password"',
    );
  });

  it('rejects containing sequential numbers', () => {
    const p = 'Pass123456!x';
    expect(policy.evaluate(p).valid).toBe(false);
    expect(policy.evaluate(p).errors).toContain(
      'Password cannot contain sequential numbers',
    );
  });

  it('rejects containing keyboard patterns', () => {
    const p = 'QwertyPass1234';
    expect(policy.evaluate(p).valid).toBe(false);
    expect(policy.evaluate(p).errors).toContain(
      'Password cannot contain keyboard patterns',
    );
  });

  it('accepts a 12+ char password with no special chars', () => {
    const result = policy.evaluate('correcthorsebattery');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns all errors for an invalid password', () => {
    const result = policy.evaluate('qwerty123456');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
