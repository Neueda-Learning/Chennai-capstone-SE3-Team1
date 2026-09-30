/**
 * The instruments a trader may pick on the ticket.
 *
 * There is no instruments endpoint in the Trade REST API contract — it exposes
 * accounts, balances, orders, positions and transfers, and nothing to list
 * tradable symbols. So this list is a local copy, and the copy has to come
 * from the same source the API validates against or the dropdown will happily
 * offer a symbol that comes back `INS-404`.
 *
 * Mirrors the active rows of `seed/040_instruments.csv`, which is what
 * `migrations/004_instruments.sql` loads. `LEGACYCORP` is deliberately absent:
 * that row is `active = false`, and the schema makes `active` the switch for
 * "tradable" (instruments are retired, never deleted).
 *
 * If an instruments endpoint is ever added, replace this file with a fetch and
 * leave the shape alone.
 */
export interface TradableInstrument {
  symbol: string;
  name: string;
}

export const TRADABLE_INSTRUMENTS: readonly TradableInstrument[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'TCS', name: 'Tata Consultancy Services' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank' },
  { symbol: 'ITC', name: 'ITC' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors' }
];
