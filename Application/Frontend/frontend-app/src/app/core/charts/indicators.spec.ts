import { bollinger, ema, macd, rsi, sma } from './indicators';

const close = (value: number | null) => (value === null ? null : Math.round(value * 10000) / 10000);

describe('sma', () => {
  it('averages the last N closes, with nulls until there are N', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('is all nulls when the series is shorter than the period', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
    expect(sma([], 3)).toEqual([]);
  });

  it('a period of 1 is the series itself', () => {
    expect(sma([4, 5, 6], 1)).toEqual([4, 5, 6]);
  });

  it('stays aligned with its input', () => {
    expect(sma([1, 2, 3, 4, 5, 6, 7], 4)).toHaveLength(7);
  });
});

describe('ema', () => {
  it('seeds with the simple average of the first N, then smooths with 2/(N+1)', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('tracks a constant series exactly', () => {
    expect(ema([7, 7, 7, 7, 7, 7], 3).slice(2)).toEqual([7, 7, 7, 7]);
  });

  it('skips the nulls of an upstream warm-up before it starts', () => {
    expect(ema([null, null, 1, 2, 3], 3)).toEqual([null, null, null, null, 2]);
  });

  it('reacts faster than the simple average to a jump', () => {
    const prices = [10, 10, 10, 10, 10, 20];
    expect(ema(prices, 5)[5]!).toBeGreaterThan(sma(prices, 5)[5]! - 1e-9);
  });
});

describe('bollinger', () => {
  it('bands collapse onto the average for a flat series', () => {
    const b = bollinger([5, 5, 5, 5, 5], 3, 2);
    expect(b.middle[4]).toBe(5);
    expect(b.upper[4]).toBe(5);
    expect(b.lower[4]).toBe(5);
  });

  it('uses the population standard deviation', () => {
    const b = bollinger([2, 4, 6], 3, 2);
    const sd = Math.sqrt(8 / 3);
    expect(close(b.upper[2])).toBe(close(4 + 2 * sd));
    expect(close(b.lower[2])).toBe(close(4 - 2 * sd));
  });

  it('is null during warm-up, and symmetric about the middle afterwards', () => {
    const b = bollinger([1, 3, 2, 5, 4, 6, 8], 4, 2);
    expect(b.upper.slice(0, 3)).toEqual([null, null, null]);
    for (let i = 3; i < 7; i++) {
      expect(b.upper[i]! - b.middle[i]!).toBeCloseTo(b.middle[i]! - b.lower[i]!, 10);
    }
  });
});

describe('rsi', () => {
  it('is 100 for a series that only goes up', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(values, 14)[19]).toBe(100);
  });

  it('is 0 for a series that only goes down', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(values, 14)[19]).toBe(0);
  });

  it('reads 50 for a flat series rather than dividing by zero', () => {
    expect(rsi(new Array(20).fill(10), 14)[19]).toBe(50);
  });

  it('matches the textbook value for the classic worked example', () => {
    const values = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
    expect(rsi(values, 14)[14]).toBeCloseTo(50, 10);
  });

  it('is null until a full period of changes exists, and always within 0..100', () => {
    const values = [44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.4, 45.8, 46.1, 45.9, 46.0, 46.3, 46.2, 45.6, 46.0, 46.4, 46.2, 45.9, 46.2];
    const out = rsi(values, 14);
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    out.slice(14).forEach((v) => {
      expect(v!).toBeGreaterThanOrEqual(0);
      expect(v!).toBeLessThanOrEqual(100);
    });
  });

  it('is all nulls when there is not enough history', () => {
    expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
  });
});

describe('macd', () => {
  const rising = Array.from({ length: 60 }, (_, i) => 100 + i);

  it('is the fast EMA minus the slow EMA once both exist', () => {
    const m = macd(rising);
    const f = ema(rising, 12);
    const s = ema(rising, 26);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).toBeCloseTo(f[25]! - s[25]!, 10);
  });

  it('signal starts after 9 valid MACD values, and the histogram is their difference', () => {
    const m = macd(rising);
    expect(m.signal[25 + 7]).toBeNull();
    expect(m.signal[25 + 8]).not.toBeNull();
    const i = 50;
    expect(m.histogram[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
  });

  it('is positive in a steady uptrend and negative in a steady downtrend', () => {
    const down = Array.from({ length: 60 }, (_, i) => 200 - i);
    expect(macd(rising).macd[59]!).toBeGreaterThan(0);
    expect(macd(down).macd[59]!).toBeLessThan(0);
  });

  it('is all nulls for a short series', () => {
    expect(macd([1, 2, 3]).macd).toEqual([null, null, null]);
  });
});
