import { TradeSignal } from '../core/services/advice.service';

/** A published BUY on TCS, held and watched, with a prediction: the shape GET .../advice returns. */
export const BUY_TCS: TradeSignal = {
  symbol: 'TCS',
  name: 'Tata Consultancy Services',
  sources: ['HOLDING', 'WATCHLIST'],
  heldQuantity: 10,
  averageCost: 3000,
  status: 'OK',
  suggestion: 'BUY',
  confidence: 'HIGH',
  score: 70,
  summary: 'BUY (high confidence, score +70): up trend, +15.6% over 20 sessions.',
  reasons: ['Uptrend: the 20-day average (110.00) is above the 50-day (104.00).', 'Momentum: +15.60% over 20 sessions.'],
  indicators: { close: 112, sma20: 110, sma50: 104, rsi14: 62, return20dPct: 15.6, volatilityPct: 24, maxDrawdownPct: -8, trend: 'UP' },
  asOf: '2026-10-06',
  stale: false,
  prediction: {
    forDate: '2026-10-07', asOf: '2026-10-06', lastClose: 112, predictedClose: 112.4, low68: 110, high68: 114.5,
    low90: 108.2, high90: 116.3, probUp: 0.53, expectedReturnPct: 0.36
  }
};
