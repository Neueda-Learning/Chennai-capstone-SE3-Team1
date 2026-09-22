import { PasswordPolicy } from './password-policy';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();

  it('rejects short passwords (< 12 chars)', () => {
    expect(policy.evaluate('Short1!').valid).toBe(false);
    expect(policy.evaluate('Short1!').errors).toContain(
      'Password must be at least 12 characters',
    );
  });

  it('rejects missing uppercase', () => {
    expect(policy.evaluate('shortpass123!').valid).toBe(false);
    expect(policy.evaluate('shortpass123!').errors).toContain(
      'Password must contain an uppercase letter',
    );
  });

  it('rejects missing lowercase', () => {
    expect(policy.evaluate('SHORTPASS123!').valid).toBe(false);
    expect(policy.evaluate('SHORTPASS123!').errors).toContain(
      'Password must contain a lowercase letter',
    );
  });

  it('rejects missing number', () => {
    expect(policy.evaluate('ShortPass!').valid).toBe(false);
    expect(policy.evaluate('ShortPass!').errors).toContain(
      'Password must contain a number',
    );
  });

  it('rejects missing special character', () => {
    expect(policy.evaluate('ShortPass123').valid).toBe(false);
    expect(policy.evaluate('ShortPass123').errors).toContain(
      'Password must contain a special character',
    );
  });

  it('rejects containing "password"', () => {
    expect(policy.evaluate('Password123!').valid).toBe(false);
    expect(policy.evaluate('Password123!').errors).toContain(
      'Password cannot contain "password"',
    );
  });

  it('rejects containing sequential numbers', () => {
    expect(policy.evaluate('Pass123456!').valid).toBe(false);
    expect(policy.evaluate('Pass123456!').errors).toContain(
      'Password cannot contain sequential numbers',
    );
  });

  it('rejects containing keyboard patterns', () => {
    expect(policy.evaluate('QwertyPass1!').valid).toBe(false);
    expect(policy.evaluate('QwertyPass1!').errors).toContain(
      'Password cannot contain keyboard patterns',
    );
  });

  it('accepts valid password', () => {
    const result = policy.evaluate('Strong-Pass-123!');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns all errors for invalid password', () => {
    const result = policy.evaluate('short');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
