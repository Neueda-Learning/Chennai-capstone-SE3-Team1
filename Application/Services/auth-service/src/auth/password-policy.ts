export interface PolicyResult {
  valid: boolean;
  errors: string[];
}

const KEYBOARD_ROWS = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
] as const;

function hasSequentialRun(value: string, minRun = 4): boolean {
  for (let i = 0; i + minRun - 1 < value.length; i++) {
    const step = value.charCodeAt(i + 1) - value.charCodeAt(i);
    if (step !== 1 && step !== -1) {
      continue;
    }
    let run = 2;
    for (let j = i + 1; j + 1 < value.length; j++) {
      if (value.charCodeAt(j + 1) - value.charCodeAt(j) !== step) {
        break;
      }
      run += 1;
      if (run >= minRun) {
        return true;
      }
    }
  }
  return false;
}

function hasKeyboardRun(value: string, minRun = 4): boolean {
  const lowered = value.toLowerCase();
  const rows = KEYBOARD_ROWS.map(
    (row) => `${row}${[...row].reverse().join('')}`,
  );
  for (const row of rows) {
    for (let i = 0; i + minRun <= lowered.length; i++) {
      if (row.includes(lowered.slice(i, i + minRun))) {
        return true;
      }
    }
  }
  return false;
}

export class PasswordPolicy {
  private readonly rules = [
    {
      test: (p: string) => p.length >= 12,
      error: 'Password must be at least 12 characters',
    },
    {
      test: (p: string) => p.length <= 128,
      error: 'Password must be at most 128 characters',
    },
    {
      test: (p: string) => /[^A-Za-z]/.test(p),
      error: 'Password must contain at least one number or special character',
    },
    {
      test: (p: string) => !/password/i.test(p),
      error: 'Password cannot contain "password"',
    },
    {
      test: (p: string) => !hasSequentialRun(p),
      error: 'Password cannot contain sequential numbers or letters',
    },
    {
      test: (p: string) => !hasKeyboardRun(p),
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
