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

  it('requires at least one number or special character', () => {
    expect(policy.evaluate('twelvecharlower').valid).toBe(false);
    expect(policy.evaluate('ALLUPPERONLYLETTERS').valid).toBe(false);
    expect(policy.evaluate('twelvecharlower').errors).toContain(
      'Password must contain at least one number or special character',
    );
    expect(policy.evaluate('twelvecharlo7er').valid).toBe(true);
    expect(policy.evaluate('twelvechars!').valid).toBe(true);
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
      'Password cannot contain sequential numbers or letters',
    );
  });

  it('rejects sequential runs the old literal check missed', () => {
    expect(policy.evaluate('345678345678').valid).toBe(false);
    expect(policy.evaluate('987654987654').valid).toBe(false);
    expect(policy.evaluate('abcdefghijkl').valid).toBe(false);
    expect(policy.evaluate('345678345678').errors.join()).toContain(
      'sequential',
    );
  });

  it('rejects keyboard patterns on any row and in either direction', () => {
    expect(policy.evaluate('QwertyPass1234').valid).toBe(false);
    expect(policy.evaluate('asdfghzxcvbn').valid).toBe(false);
    expect(policy.evaluate('dfghjkdfghjk').valid).toBe(false);
    expect(policy.evaluate('poiuytrewqaa').valid).toBe(false);
    expect(policy.evaluate('dfghjkdfghjk').errors.join()).toContain('keyboard');
  });

  it('does not flag incidental short pairs', () => {
    expect(policy.evaluate('12ab34cd56efg').valid).toBe(true);
  });

  it('accepts a 12+ char password with a number or special char', () => {
    const result = policy.evaluate('correcthorsebattery7');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns all errors for an invalid password', () => {
    const result = policy.evaluate('qwerty123456');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
