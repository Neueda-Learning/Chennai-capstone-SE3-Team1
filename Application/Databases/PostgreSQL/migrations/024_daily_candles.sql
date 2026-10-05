BEGIN;

-- =============================================================================
-- daily_candles: a year of end-of-day history per instrument, for the long-range charts.
--
-- Fauxnance serves history one symbol per request and only as daily candles, so the Trade API
-- fetches it once per instrument per day and keeps it here; every chart after that reads this
-- table and spends no quota. Intraday candles (1m ... 1h) are not stored: they are built on demand
-- from market_quotes, which already holds a tick a minute.
--
-- daily_candle_syncs records when each instrument was last fetched, so "have we asked today" is a
-- one-row lookup rather than a guess from the data (a quiet day can legitimately add no row).
-- =============================================================================

CREATE TABLE daily_candles (
    instrument_id  VARCHAR(20)    NOT NULL REFERENCES instruments(instrument_id),
    trade_date     DATE           NOT NULL,
    open_price     DECIMAL(18,4)  NOT NULL,
    high_price     DECIMAL(18,4)  NOT NULL,
    low_price      DECIMAL(18,4)  NOT NULL,
    close_price    DECIMAL(18,4)  NOT NULL,
    adj_close      DECIMAL(18,4),
    volume         BIGINT,
    synthetic      BOOLEAN        NOT NULL DEFAULT FALSE,
    PRIMARY KEY (instrument_id, trade_date),
    CONSTRAINT chk_daily_candles_prices_positive
        CHECK (open_price > 0 AND high_price > 0 AND low_price > 0 AND close_price > 0),
    CONSTRAINT chk_daily_candles_high_low CHECK (high_price >= low_price),
    CONSTRAINT chk_daily_candles_volume_non_negative CHECK (volume IS NULL OR volume >= 0)
);

CREATE TABLE daily_candle_syncs (
    instrument_id  VARCHAR(20)    PRIMARY KEY REFERENCES instruments(instrument_id),
    synced_on      DATE           NOT NULL,
    covers_from    DATE           NOT NULL,
    candle_count   INT            NOT NULL DEFAULT 0
);

COMMIT;
