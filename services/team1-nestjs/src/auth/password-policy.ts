export interface PolicyResult {
  valid: boolean;
  errors: string[];
}

export class PasswordPolicy {
  private readonly rules = [
    {
      test: (p: string) => p.length >= 12,
      error: 'Password must be at least 12 characters',
    },
    {
      test: (p: string) => /[A-Z]/.test(p),
      error: 'Password must contain an uppercase letter',
    },
    {
      test: (p: string) => /[a-z]/.test(p),
      error: 'Password must contain a lowercase letter',
    },
    {
      test: (p: string) => /[0-9]/.test(p),
      error: 'Password must contain a number',
    },
    {
      test: (p: string) => /[^A-Za-z0-9]/.test(p),
      error: 'Password must contain a special character',
    },
    {
      test: (p: string) => !/password/i.test(p),
      error: 'Password cannot contain "password"',
    },
    {
      test: (p: string) => !/123456/.test(p),
      error: 'Password cannot contain sequential numbers',
    },
    {
      test: (p: string) => !/qwerty/i.test(p),
      error: 'Password cannot contain keyboard patterns',
    },
  ];

  evaluate(password: string): PolicyResult {
    const errors = this.rules
      .filter((r) => !r.test(password))
      .map((r) => r.error);
    return { valid: errors.length === 0, errors };
  }
}
