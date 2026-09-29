import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Client-side checks for the order ticket.
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

/** Business rule 5: price is greater than zero. */
export function priceAboveZero(control: AbstractControl): ValidationErrors | null {
  const value = rawValue(control);

  if (value === '') {
    return { required: true };
  }

  if (!/^\d*\.?\d+$/.test(value)) {
    return { priceFormat: true };
  }

  return Number(value) > 0 ? null : { min: { min: 0, actual: Number(value) } };
}

/** Money is held as a decimal string; the contract caps it at two places. */
export function atMostTwoDecimals(control: AbstractControl): ValidationErrors | null {
  const value = rawValue(control);

  if (value === '' || !value.includes('.')) {
    return null;
  }

  const [, decimals = ''] = value.split('.');

  return decimals.length <= 2 ? null : { decimals: { max: 2, actual: decimals.length } };
}

/**
 * The instrument scheme the contract describes: a plain ticker for US
 * equities, one `.NS`/`.BO` suffix for NSE or BSE, or one `FX:`/`X:` prefix
 * for a currency pair or crypto. Cheap to check, and it stops a typo becoming
 * a symbol the server will only answer `INS-404` to.
 */
export function tradableSymbol(control: AbstractControl): ValidationErrors | null {
  const value = rawValue(control);

  if (value === '') {
    return { required: true };
  }

  const prefixed = /^(FX|X):[A-Za-z0-9]+$/i;
  const plainOrSuffixed = /^[A-Za-z0-9]+(\.(NS|BO))?$/i;

  return prefixed.test(value) || plainOrSuffixed.test(value) ? null : { symbolFormat: true };
}

/** A valid order, ready to hand to `OrdersService.placeOrder`. */
export function priceValidators(): ValidatorFn[] {
  return [priceAboveZero, atMostTwoDecimals];
}
