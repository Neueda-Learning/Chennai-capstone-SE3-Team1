import { formatMoney, formatMoneyWhole, formatSignedMoney, formatSignedPercent, roundToPaise } from './money';

describe('money formatting', () => {
  it('prints rupees with Indian digit grouping and two decimals', () => {
    expect(formatMoney(123456.7)).toBe('₹1,23,456.70');
    expect(formatMoney(0)).toBe('₹0.00');
    expect(formatMoney(-50.5)).toBe('-₹50.50');
  });

  it('prints a dash for a value that is not known', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
    expect(formatMoneyWhole(null)).toBe('—');
    expect(formatSignedMoney(null)).toBe('—');
    expect(formatSignedPercent(undefined)).toBe('—');
  });

  it('rounds headline figures to whole rupees', () => {
    expect(formatMoneyWhole(106754.25)).toBe('₹1,06,754');
  });

  it('always spells out the sign of a gain or loss', () => {
    expect(formatSignedMoney(1200)).toBe('+₹1,200.00');
    expect(formatSignedMoney(-300)).toBe('-₹300.00');
    expect(formatSignedMoney(0)).toBe('₹0.00');
  });

  it('formats percentages with a sign and two decimals', () => {
    expect(formatSignedPercent(1.25)).toBe('+1.25%');
    expect(formatSignedPercent(-0.4)).toBe('-0.40%');
    expect(formatSignedPercent(0)).toBe('0.00%');
  });

  it('rounds to the paisa', () => {
    expect(roundToPaise(10.005)).toBe(10.01);
    expect(roundToPaise(1300.1 * 10)).toBe(13001);
    expect(roundToPaise(0.1 + 0.2)).toBe(0.3);
  });
});
