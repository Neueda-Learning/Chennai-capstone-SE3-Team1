import {
  INDICATORS,
  INTERVALS,
  MAX_CANDLES,
  RANGES,
  defaultIntervalFor,
  intervalsFor,
  reconcileInterval
} from './chart-options';

const range = (value: string) => RANGES.find((r) => r.value === value)!;
const interval = (value: string) => INTERVALS.find((i) => i.value === value)!;
const values = (r: string) => intervalsFor(range(r)).map((i) => i.value);

describe('chart ranges and intervals', () => {
  it('offers finer candles than the old 1H/8H only: down to one minute, up to one month', () => {
    expect(INTERVALS.map((i) => i.value)).toEqual(['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1mo']);
  });

  it('short ranges allow fine candles', () => {
    expect(values('1h')).toEqual(['1m', '5m', '15m', '30m', '1h']);
    expect(values('1d')).toEqual(['1m', '5m', '15m', '30m', '1h']);
  });

  it('long intraday ranges drop the candle sizes that would exceed the API limit', () => {
    expect(values('3d')).toEqual(['5m', '15m', '30m', '1h']);
    expect(values('1w')).toEqual(['15m', '30m', '1h']);
  });

  it('never offers a combination of more than 2,000 candles', () => {
    for (const r of RANGES.filter((x) => x.kind === 'intraday')) {
      for (const i of intervalsFor(r)) {
        expect((r.seconds as number) / i.seconds).toBeLessThanOrEqual(MAX_CANDLES);
      }
    }
  });

  it('never offers a candle bigger than the range itself', () => {
    for (const r of RANGES.filter((x) => x.kind === 'intraday')) {
      for (const i of intervalsFor(r)) {
        expect(i.seconds).toBeLessThanOrEqual(r.seconds as number);
      }
    }
  });

  it('daily ranges only offer daily-family candles', () => {
    expect(values('1mo')).toEqual(['1d']);
    expect(values('3mo')).toEqual(['1d', '1w']);
    expect(values('ytd')).toEqual(['1d', '1w', '1mo']);
    expect(values('1y')).toEqual(['1d', '1w', '1mo']);
  });

  it('every range has a default interval that is itself valid for it', () => {
    for (const r of RANGES) {
      expect(intervalsFor(r).map((i) => i.value)).toContain(defaultIntervalFor(r).value);
    }
  });

  it('keeps the chosen interval when it still fits the new range', () => {
    expect(reconcileInterval(range('1d'), interval('15m')).value).toBe('15m');
  });

  it('falls back to the range default when it does not fit (1m over a week, or a daily candle over a day)', () => {
    expect(reconcileInterval(range('1w'), interval('1m')).value).toBe('30m');
    expect(reconcileInterval(range('1d'), interval('1w')).value).toBe('5m');
    expect(reconcileInterval(range('3mo'), interval('15m')).value).toBe('1d');
    expect(reconcileInterval(range('1y'), null).value).toBe('1w');
  });

  it('lists the indicators asked for, and marks which sit over the price', () => {
    expect(INDICATORS.map((i) => i.id)).toEqual(['sma20', 'sma50', 'ema20', 'bollinger', 'volume', 'rsi', 'macd']);
    expect(INDICATORS.filter((i) => i.overlay).map((i) => i.id)).toEqual(['sma20', 'sma50', 'ema20', 'bollinger']);
    expect(INDICATORS.find((i) => i.id === 'volume')!.needsVolume).toBe(true);
  });
});
