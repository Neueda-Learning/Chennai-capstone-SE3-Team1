/**
 * Money and percentage formatting, in one place so every screen prints a number the same way.
 *
 * Everything the platform trades is an NSE instrument priced in rupees, and the blotter has
 * always printed rupees, so that is the currency used throughout. (The Trade API's balance
 * response carries a `currency` field too, but it comes from a deployment default of `USD`
 * that disagrees with the instruments; the rupee is what the numbers actually are.)
 */
const CURRENCY = 'INR';
const LOCALE = 'en-IN';

const money = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const compact = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0
});

/** `₹1,23,456.70`; a dash for a value that is not known yet. */
export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : money.format(value);
}

/** `₹1,23,457`: whole rupees, for headline figures. */
export function formatMoneyWhole(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : compact.format(value);
}

/** `+₹1,200.00` / `-₹300.00`: money with its sign always spelled out. */
export function formatSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return sign + money.format(Math.abs(value));
}

/** `+1.25%` / `-0.40%`. */
export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** Rounds to paise, away from binary floating point noise (`1.005` style traps aside). */
export function roundToPaise(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
