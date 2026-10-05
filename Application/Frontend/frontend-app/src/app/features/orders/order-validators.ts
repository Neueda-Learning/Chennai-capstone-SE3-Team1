import { AbstractControl, ValidationErrors } from '@angular/forms';

function rawValue(control: AbstractControl): string {
  const value = control.value;
  return value === null || value === undefined ? '' : String(value).trim();
}

export function wholeQuantity(control: AbstractControl): ValidationErrors | null {
  const value = rawValue(control);

  if (value === '') {
    return { required: true };
  }

  if (!/^\d+$/.test(value)) {
    return { wholeQuantity: true };
  }

  return Number(value) > 0 ? null : { min: { min: 1, actual: Number(value) } };
}
