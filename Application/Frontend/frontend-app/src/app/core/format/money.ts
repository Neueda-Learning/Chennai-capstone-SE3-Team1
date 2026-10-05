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

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : money.format(value);
}

export function formatMoneyWhole(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : compact.format(value);
}

export function formatSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return sign + money.format(Math.abs(value));
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function roundToPaise(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
