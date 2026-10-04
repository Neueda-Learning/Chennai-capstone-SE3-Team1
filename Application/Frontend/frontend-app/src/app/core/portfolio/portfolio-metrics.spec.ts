import { OrderHistoryEntry } from '../../generated/trade-client';
import { MarketQuote } from '../services/market.service';
import { PortfolioEntry } from '../services/portfolio.service';
import { bucketOrders, countOrders, orderValue, priceEntries, summarise } from './portfolio-metrics';

const quote = (overrides: Partial<MarketQuote>): MarketQuote => ({
  symbol: 'RELIANCE',
  name: 'Reliance Industries',
  price: 1300,
  bid: null,
  ask: null,
  currency: 'INR',
  change: null,
  changePercent: null,
  previousClose: null,
  marketState: null,
  stale: false,
  quoteAsOf: null,
  receivedAt: null,
  ...overrides
});

const entry = (overrides: Partial<PortfolioEntry>): PortfolioEntry => ({
  accountId: 1,
  symbol: 'RELIANCE',
  quantity: 10,
  averageCost: 1250,
  overallGains: 0,
  ...overrides
});

const order = (overrides: Partial<OrderHistoryEntry>): OrderHistoryEntry => ({
  orderId: 'ORD-1',
  accountId: 1,
  symbol: 'RELIANCE',
  side: 'BUY',
  quantity: 1,
  price: 100,
  executedPrice: null,
  status: 'FILLED',
  createdOn: '2026-10-02T10:00:00',
  ...overrides
});

describe('priceEntries', () => {
  it('values an entry at its live quote', () => {
    const [priced] = priceEntries([entry({})], 'HOLDING', [quote({ price: 1400, change: 10 })]);

    expect(priced).toMatchObject({ lastPrice: 1400, priceIsLive: true, cost: 12500, value: 14000, gain: 1500, dayChange: 100, name: 'Reliance Industries' });
    expect(priced.gainPercent).toBeCloseTo(12);
  });

  it('recovers the price from the stored gain when there is no quote', () => {
    const [priced] = priceEntries([entry({ overallGains: 500 })], 'HOLDING', []);

    expect(priced.lastPrice).toBe(1300); // 1250 + 500 / 10
    expect(priced.priceIsLive).toBe(false);
    expect(priced.dayChange).toBeNull();
    expect(priced.name).toBe('RELIANCE');
  });

  it('treats an unpriced quote (the poller has not seen it yet) as no quote', () => {
    const [priced] = priceEntries([entry({ overallGains: 500 })], 'HOLDING', [quote({ price: null })]);

    expect(priced.priceIsLive).toBe(false);
    expect(priced.lastPrice).toBe(1300);
  });

  it('carries a zero-quantity entry at cost rather than dividing by zero', () => {
    const [priced] = priceEntries([entry({ quantity: 0, overallGains: 0 })], 'HOLDING', []);

    expect(priced.lastPrice).toBe(1250);
    expect(priced.value).toBe(0);
    expect(priced.gainPercent).toBeNull();
  });

  it('gains on a short when the price falls', () => {
    const [priced] = priceEntries([entry({ quantity: -2, averageCost: 3400 })], 'POSITION', [quote({ price: 3300 })]);

    expect(priced.value).toBe(-6600);
    expect(priced.cost).toBe(-6800);
    expect(priced.gain).toBe(200);
    expect(priced.gainPercent).toBeCloseTo((200 / 6800) * 100);
  });
});

describe('summarise', () => {
  it('adds cash to what is held, and reports gain against cost', () => {
    const entries = priceEntries([entry({}), entry({ symbol: 'TCS', quantity: 5, averageCost: 3400 })], 'HOLDING', [
      quote({ price: 1400, change: 10 }),
      quote({ symbol: 'TCS', price: 3300, change: -20 })
    ]);

    const summary = summarise(5000, entries);

    expect(summary.investedValue).toBe(14000 + 16500);
    expect(summary.cost).toBe(12500 + 17000);
    expect(summary.totalValue).toBe(5000 + 30500);
    expect(summary.unrealised).toBe(1000);
    expect(summary.dayPnl).toBe(0); // +100 on RELIANCE, -100 on TCS
  });

  it('reports no day move at all when no quote covers anything', () => {
    const summary = summarise(100, priceEntries([entry({})], 'HOLDING', []));

    expect(summary.dayPnl).toBeNull();
    expect(summary.dayPercent).toBeNull();
  });

  it('is just the cash for an empty portfolio', () => {
    const summary = summarise(2500, []);

    expect(summary).toMatchObject({ totalValue: 2500, investedValue: 0, unrealised: 0, unrealisedPercent: null, dayPnl: null });
  });
});

describe('countOrders', () => {
  it('counts each status', () => {
    const counts = countOrders([
      order({ status: 'FILLED' }),
      order({ status: 'FILLED' }),
      order({ status: 'NEW' }),
      order({ status: 'REJECTED' }),
      order({ status: 'CANCELLED' })
    ]);

    expect(counts).toEqual({ total: 5, filled: 2, working: 1, rejected: 1, cancelled: 1 });
  });
});

describe('bucketOrders', () => {
  const now = new Date(2026, 9, 2, 15, 30); // 2 Oct 2026, local time

  it('is one bucket a day for a week, ending today', () => {
    const flow = bucketOrders(
      [
        order({ side: 'BUY', createdOn: '2026-10-02T09:00:00' }),
        order({ side: 'BUY', createdOn: '2026-10-02T11:00:00' }),
        order({ side: 'SELL', createdOn: '2026-10-01T09:00:00' }),
        order({ side: 'SELL', createdOn: '2026-09-26T09:00:00' })
      ],
      7,
      now
    );

    expect(flow.categories).toHaveLength(7);
    expect(flow.buys).toEqual([0, 0, 0, 0, 0, 0, 2]);
    expect(flow.sells).toEqual([1, 0, 0, 0, 0, 1, 0]);
  });

  it('is one bucket a week for longer ranges', () => {
    const flow = bucketOrders([order({ createdOn: '2026-10-02T09:00:00' })], 30, now);

    expect(flow.categories).toHaveLength(5);
    expect(flow.buys[4]).toBe(1);
  });

  it('ignores orders older than the range and ones with unreadable dates', () => {
    const flow = bucketOrders([order({ createdOn: '2025-01-01T00:00:00' }), order({ createdOn: 'garbage' })], 7, now);

    expect(flow.buys.concat(flow.sells).every((n) => n === 0)).toBe(true);
  });
});

describe('orderValue', () => {
  it('uses what a filled order executed at, else the order price', () => {
    expect(orderValue(order({ quantity: 10, price: 1325, executedPrice: 1300 }))).toBe(13000);
    expect(orderValue(order({ quantity: 10, price: 1325, executedPrice: null, status: 'REJECTED' }))).toBe(13250);
  });
});
