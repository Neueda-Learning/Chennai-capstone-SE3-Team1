import {
  hasKeyboardRun,
  hasSequentialRun,
  passwordPolicyPassed,
  passwordRequirements
} from './password-rules';

/**
 * This module is a mirror of `PasswordPolicy` in
 * `Services/auth-service/src/auth/password-policy.ts`. These cases are the ones
 * that broke the first version of the rule, so they are the ones worth pinning.
 */
describe('password rules', () => {
  function requirementMet(password: string, label: string): boolean | undefined {
    return passwordRequirements(password).find((item) => item.label.includes(label))?.met;
  }

  it('passes a long password with a digit and no forbidden content', () => {
    expect(passwordPolicyPassed('correct horse battery7')).toBe(true);
  });

  it('fails anything under twelve characters', () => {
    expect(requirementMet('short7', 'At least 12')).toBe(false);
    expect(passwordPolicyPassed('elevenchars')).toBe(false);
  });

  it('fails a password with no number or special character', () => {
    expect(requirementMet('twelvecharacters', 'number or special')).toBe(false);
    expect(passwordPolicyPassed('twelvecharacters')).toBe(false);
  });

  it('accepts a special character in place of a digit', () => {
    expect(passwordPolicyPassed('lantern!tulip')).toBe(true);
  });

  it('fails over 128 characters', () => {
    expect(requirementMet(`${'a'.repeat(129)}7`, 'No more than 128')).toBe(false);
  });

  it('rejects the literal "password" in any case', () => {
    expect(requirementMet('Password123456', 'Not contain')).toBe(false);
    expect(requirementMet('myPASSWORD!2026x', 'Not contain')).toBe(false);
  });

  it('rejects runs of four ascending or descending numbers', () => {
    expect(requirementMet('345678345678', 'Not contain')).toBe(false);
    expect(requirementMet('987654987654', 'Not contain')).toBe(false);
    expect(hasSequentialRun('1234')).toBe(true);
    expect(hasSequentialRun('4321')).toBe(true);
  });

  it('rejects four characters from a keyboard row, forwards or backwards', () => {
    expect(requirementMet('dfghjkdfghjk', 'Not contain')).toBe(false);
    expect(requirementMet('asdfghzxcvbn', 'Not contain')).toBe(false);
    expect(requirementMet('poiuytrewqaa', 'Not contain')).toBe(false);
    expect(requirementMet('abcdefghijkl', 'Not contain')).toBe(false);
    expect(hasKeyboardRun('qwer')).toBe(true);
    expect(hasKeyboardRun('rewq')).toBe(true);
  });

  it('does not mistake a longer word for a run', () => {
    expect(requirementMet('12ab34cd56efg', 'Not contain')).toBe(true);
    expect(hasSequentialRun('1212')).toBe(false);
    expect(hasKeyboardRun('tulip')).toBe(false);
  });
});
