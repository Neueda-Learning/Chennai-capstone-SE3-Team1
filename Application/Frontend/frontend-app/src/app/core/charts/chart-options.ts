/**
 * What the price chart can show: which ranges, which candle sizes over each range, and which
 * indicators. The combinations mirror the Trade API's rules (`CandleService`): intraday candles
 * (built from the minute quotes it stores) over short ranges, daily and longer candles (from a year
 * of end-of-day history) over long ones, and never more than 2,000 candles in one response.
 */
export interface ChartRange {
  /** The label on the button. */
  label: string;
  /** The API's `range` value. */
  value: string;
  /** Intraday (candles built from minute quotes) or daily (from stored end-of-day history). */
  kind: 'intraday' | 'daily';
  /** Seconds the range spans, for the intraday ones; used to rule out too many candles. */
  seconds?: number;
}

export interface ChartInterval {
  label: string;
  /** The API's `interval` value. */
  value: string;
  seconds: number;
  kind: 'intraday' | 'daily';
}

export const MAX_CANDLES = 2000;

export const RANGES: readonly ChartRange[] = [
  { label: '1H', value: '1h', kind: 'intraday', seconds: 3_600 },
  { label: '3H', value: '3h', kind: 'intraday', seconds: 10_800 },
  { label: '8H', value: '8h', kind: 'intraday', seconds: 28_800 },
  { label: '1D', value: '1d', kind: 'intraday', seconds: 86_400 },
  { label: '3D', value: '3d', kind: 'intraday', seconds: 259_200 },
  { label: '1W', value: '1w', kind: 'intraday', seconds: 604_800 },
  { label: '1M', value: '1mo', kind: 'daily' },
  { label: '3M', value: '3mo', kind: 'daily' },
  { label: '6M', value: '6mo', kind: 'daily' },
  { label: 'YTD', value: 'ytd', kind: 'daily' },
  { label: '1Y', value: '1y', kind: 'daily' }
];

export const INTERVALS: readonly ChartInterval[] = [
  { label: '1m', value: '1m', seconds: 60, kind: 'intraday' },
  { label: '5m', value: '5m', seconds: 300, kind: 'intraday' },
  { label: '15m', value: '15m', seconds: 900, kind: 'intraday' },
  { label: '30m', value: '30m', seconds: 1_800, kind: 'intraday' },
  { label: '1h', value: '1h', seconds: 3_600, kind: 'intraday' },
  { label: '1D', value: '1d', seconds: 86_400, kind: 'daily' },
  { label: '1W', value: '1w', seconds: 604_800, kind: 'daily' },
  { label: '1M', value: '1mo', seconds: 2_592_000, kind: 'daily' }
];

/** Daily ranges are too short to show a month-long candle usefully, so these are the sensible ones. */
const DAILY_INTERVALS_BY_RANGE: Record<string, string[]> = {
  '1mo': ['1d'],
  '3mo': ['1d', '1w'],
  '6mo': ['1d', '1w'],
  ytd: ['1d', '1w', '1mo'],
  '1y': ['1d', '1w', '1mo']
};

const DEFAULT_INTERVAL: Record<string, string> = {
  '1h': '1m',
  '3h': '5m',
  '8h': '5m',
  '1d': '5m',
  '3d': '15m',
  '1w': '30m',
  '1mo': '1d',
  '3mo': '1d',
  '6mo': '1d',
  ytd: '1d',
  '1y': '1w'
};

/** The candle sizes that make sense over `range`: same family, and few enough candles to draw. */
export function intervalsFor(range: ChartRange): ChartInterval[] {
  if (range.kind === 'daily') {
    const allowed = DAILY_INTERVALS_BY_RANGE[range.value] ?? ['1d'];
    return INTERVALS.filter((interval) => allowed.includes(interval.value));
  }
  return INTERVALS.filter(
    (interval) => interval.kind === 'intraday' && (range.seconds as number) / interval.seconds <= MAX_CANDLES && interval.seconds <= (range.seconds as number)
  );
}

export function defaultIntervalFor(range: ChartRange): ChartInterval {
  const choices = intervalsFor(range);
  return choices.find((interval) => interval.value === DEFAULT_INTERVAL[range.value]) ?? choices[0];
}

/** Keeps `interval` if it is valid over `range`, else the range's default. */
export function reconcileInterval(range: ChartRange, interval: ChartInterval | null): ChartInterval {
  return interval !== null && intervalsFor(range).some((candidate) => candidate.value === interval.value)
    ? interval
    : defaultIntervalFor(range);
}

export type IndicatorId = 'sma20' | 'sma50' | 'ema20' | 'bollinger' | 'volume' | 'rsi' | 'macd';

export interface IndicatorOption {
  id: IndicatorId;
  label: string;
  hint: string;
  /** Drawn over the price (true) or in a pane of its own underneath (false). */
  overlay: boolean;
  /** Needs traded volume, which only daily and longer candles have. */
  needsVolume?: boolean;
}

export const INDICATORS: readonly IndicatorOption[] = [
  { id: 'sma20', label: 'SMA 20', hint: '20-period simple moving average', overlay: true },
  { id: 'sma50', label: 'SMA 50', hint: '50-period simple moving average', overlay: true },
  { id: 'ema20', label: 'EMA 20', hint: '20-period exponential moving average', overlay: true },
  { id: 'bollinger', label: 'Bollinger', hint: 'Bollinger Bands (20, 2)', overlay: true },
  { id: 'volume', label: 'Volume', hint: 'Traded volume (daily candles and longer)', overlay: false, needsVolume: true },
  { id: 'rsi', label: 'RSI 14', hint: 'Relative Strength Index (14)', overlay: false },
  { id: 'macd', label: 'MACD', hint: 'MACD (12, 26, 9)', overlay: false }
];

export type ChartStyle = 'candles' | 'line';

/** What the user picked, as saved in the browser. */
export interface ChartPreferences {
  range: string;
  interval: string;
  style: ChartStyle;
  indicators: IndicatorId[];
}

export const DEFAULT_PREFERENCES: ChartPreferences = {
  range: '1d',
  interval: '5m',
  style: 'candles',
  indicators: ['sma20']
};
