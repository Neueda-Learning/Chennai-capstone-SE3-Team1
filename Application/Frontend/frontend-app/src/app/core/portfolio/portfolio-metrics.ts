import { OrderHistoryEntry } from '../../generated/trade-client';
import { MarketQuote } from '../services/market.service';
import { PortfolioEntry } from '../services/portfolio.service';

export interface PricedEntry {
  book: 'HOLDING' | 'POSITION';
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  lastPrice: number;
  priceIsLive: boolean;
  cost: number;
  value: number;
  gain: number;
  gainPercent: number | null;
  dayChange: number | null;
}

export function priceEntries(
  entries: readonly PortfolioEntry[],
  book: PricedEntry['book'],
  quotes: readonly MarketQuote[]
): PricedEntry[] {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));

  return entries.map((entry) => {
    const quote = bySymbol.get(entry.symbol);
    const live = quote?.price !== null && quote?.price !== undefined;
    const lastPrice = live
      ? (quote!.price as number)
      : entry.quantity !== 0
        ? entry.averageCost + entry.overallGains / entry.quantity
        : entry.averageCost;
    const cost = entry.quantity * entry.averageCost;
    const value = entry.quantity * lastPrice;
    const gain = value - cost;
    const dayChange =
      quote?.change !== null && quote?.change !== undefined ? entry.quantity * quote.change : null;

    return {
      book,
      symbol: entry.symbol,
      name: quote?.name ?? entry.symbol,
      quantity: entry.quantity,
      averageCost: entry.averageCost,
      lastPrice,
      priceIsLive: live,
      cost,
      value,
      gain,
      gainPercent: cost !== 0 ? (gain / Math.abs(cost)) * 100 : null,
      dayChange
    };
  });
}

export interface PortfolioSummary {
  cash: number;
  investedValue: number;
  cost: number;
  totalValue: number;
  unrealised: number;
  unrealisedPercent: number | null;
  dayPnl: number | null;
  dayPercent: number | null;
}

export function summarise(cash: number, entries: readonly PricedEntry[]): PortfolioSummary {
  const investedValue = entries.reduce((sum, entry) => sum + entry.value, 0);
  const cost = entries.reduce((sum, entry) => sum + entry.cost, 0);
  const unrealised = investedValue - cost;

  const withDay = entries.filter((entry) => entry.dayChange !== null);
  const dayPnl = withDay.length === 0 ? null : withDay.reduce((sum, entry) => sum + (entry.dayChange as number), 0);
  const openingValue = withDay.reduce((sum, entry) => sum + entry.value - (entry.dayChange as number), 0);

  return {
    cash,
    investedValue,
    cost,
    totalValue: cash + investedValue,
    unrealised,
    unrealisedPercent: cost !== 0 ? (unrealised / Math.abs(cost)) * 100 : null,
    dayPnl,
    dayPercent: dayPnl !== null && openingValue !== 0 ? (dayPnl / Math.abs(openingValue)) * 100 : null
  };
}

export interface OrderCounts {
  total: number;
  filled: number;
  working: number;
  rejected: number;
  cancelled: number;
}

export function countOrders(orders: readonly OrderHistoryEntry[]): OrderCounts {
  const counts: OrderCounts = { total: orders.length, filled: 0, working: 0, rejected: 0, cancelled: 0 };
  for (const order of orders) {
    switch (order.status) {
      case 'FILLED':
        counts.filled++;
        break;
      case 'NEW':
        counts.working++;
        break;
      case 'REJECTED':
        counts.rejected++;
        break;
      case 'CANCELLED':
        counts.cancelled++;
        break;
    }
  }
  return counts;
}

export interface OrderFlow {
  categories: string[];
  buys: number[];
  sells: number[];
}

export function bucketOrders(orders: readonly OrderHistoryEntry[], days: number, now: Date): OrderFlow {
  const bucketDays = days <= 7 ? 1 : 7;
  const bucketCount = Math.ceil(days / bucketDays);
  const dayMs = 24 * 60 * 60 * 1000;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const firstBucketStart = startOfToday - (bucketCount * bucketDays - 1) * dayMs;

  const buys = new Array<number>(bucketCount).fill(0);
  const sells = new Array<number>(bucketCount).fill(0);

  for (const order of orders) {
    const created = new Date(order.createdOn).getTime();
    if (Number.isNaN(created) || created < firstBucketStart) {
      continue;
    }
    const index = Math.floor((created - firstBucketStart) / (bucketDays * dayMs));
    if (index < 0 || index >= bucketCount) {
      continue;
    }
    (order.side === 'BUY' ? buys : sells)[index]++;
  }

  const categories = buys.map((_, index) => {
    const start = new Date(firstBucketStart + index * bucketDays * dayMs);
    return start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });

  return { categories, buys, sells };
}

export function orderValue(order: OrderHistoryEntry): number {
  return order.quantity * (order.executedPrice ?? order.price);
}
