const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

export function hasSequentialRun(value: string, minRun = 4): boolean {
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

export function hasKeyboardRun(value: string, minRun = 4): boolean {
  const lowered = value.toLowerCase();
  const rows = KEYBOARD_ROWS.map((row) => `${row}${[...row].reverse().join('')}`);
  for (const row of rows) {
    for (let i = 0; i + minRun <= lowered.length; i++) {
      if (row.includes(lowered.slice(i, i + minRun))) {
        return true;
      }
    }
  }
  return false;
}

export function passwordRequirements(password: string): PasswordRequirement[] {
  return [
    { label: 'At least 12 characters.', met: password.length >= MIN_PASSWORD_LENGTH },
    { label: 'No more than 128 characters.', met: password.length <= MAX_PASSWORD_LENGTH },
    { label: 'Contain at least one number or special character.', met: /[^A-Za-z]/.test(password) },
    {
      label: 'Not contain "password", sequential numbers, or keyboard patterns.',
      met:
        !/password/i.test(password) &&
        !hasSequentialRun(password) &&
        !hasKeyboardRun(password)
    }
  ];
}

export function passwordPolicyPassed(password: string): boolean {
  return passwordRequirements(password).every((requirement) => requirement.met);
}
