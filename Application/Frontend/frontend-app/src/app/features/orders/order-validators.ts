import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Client-side checks for the order ticket.
 *
 * Only the quantity is checked here now. The ticket has no price field - every order executes
 * at the current market price - and no symbol field either, since the ticker is picked from the
 * live market list rather than typed.
 *
 * These are not enforcement. The business rules live in the Trade REST API and
 * stay there — the form exists so the obvious mistakes never reach the wire,
 * and so the trader finds out without a round trip. The comment on each rule
 * names the server rule it mirrors.
 */

function rawValue(control: AbstractControl): string {
  const value = control.value;
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Business rule 4: quantity is whole units, greater than zero. */
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
