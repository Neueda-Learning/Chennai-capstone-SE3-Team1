/**
 * Technical indicators over a series of closing prices.
 *
 * Every function returns an array the same length as its input, with `null` where there is not
 * yet enough history to compute a value (the "warm-up"). That keeps each result index-aligned
 * with the candles it was computed from, so the chart can zip them together without bookkeeping.
 */
export type Series = (number | null)[];

/** Simple moving average over `period` closes. */
export function sma(values: readonly number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) {
    return out;
  }
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

/**
 * Exponential moving average, seeded with the simple average of the first `period` values (the
 * usual convention) and smoothed with 2 / (period + 1) after that.
 */
export function ema(values: readonly (number | null)[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period < 1) {
    return out;
  }
  const k = 2 / (period + 1);
  let seed: number[] = [];
  let previous: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      continue; // warm-up of an upstream indicator: nothing to smooth yet
    }
    if (previous === null) {
      seed.push(value);
      if (seed.length === period) {
        previous = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = previous;
        seed = [];
      }
    } else {
      previous = value * k + previous * (1 - k);
      out[i] = previous;
    }
  }
  return out;
}

export interface Bollinger {
  middle: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger Bands: the `period` average, and `multiplier` population standard deviations either side. */
export function bollinger(values: readonly number[], period = 20, multiplier = 2): Bollinger {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) {
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (values[j] - mean) ** 2;
    }
    const deviation = Math.sqrt(variance / period);
    upper[i] = mean + multiplier * deviation;
    lower[i] = mean - multiplier * deviation;
  }
  return { middle, upper, lower };
}

/**
 * Relative Strength Index with Wilder's smoothing. 100 when there have been no losses over the
 * window, 0 when no gains; a flat series reads 50 rather than dividing by zero.
 */
export function rsi(values: readonly number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) {
    return out;
  }
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  out[period] = strength(averageGain, averageLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = strength(averageGain, averageLoss);
  }
  return out;
}

function strength(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }
  return 100 - 100 / (1 + averageGain / averageLoss);
}

export interface Macd {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD: the fast EMA minus the slow EMA, its own signal EMA, and the gap between the two. */
export function macd(values: readonly number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: Series = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });
  const signal = ema(line, signalPeriod);
  const histogram: Series = line.map((m, i) => (m === null || signal[i] === null ? null : m - (signal[i] as number)));
  return { macd: line, signal, histogram };
}
