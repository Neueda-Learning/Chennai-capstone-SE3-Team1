BEGIN;

-- =============================================================================
-- market_quotes: the price history the order screen charts.
--
-- The market-data poller already publishes one QUOTE per symbol per cycle onto the
-- market-data topic, and the Trade API already consumes it to mark holdings to market
-- (MarketDataListener). Until now nothing kept the quotes themselves, so there was no
-- "latest price" or chart to show. The same listener now also appends each quote here.
--
-- One row per quote received, never updated. The listener trims rows older than a few
-- days as it inserts, so this stays a rolling window and not an archive.
-- =============================================================================

CREATE TABLE market_quotes (
    quote_id        BIGSERIAL       PRIMARY KEY,
    instrument_id   VARCHAR(20)     NOT NULL REFERENCES instruments(instrument_id),
    price           DECIMAL(18,4)   NOT NULL,
    bid             DECIMAL(18,4),
    ask             DECIMAL(18,4),
    currency        VARCHAR(3),
    day_change      DECIMAL(18,4),
    change_percent  DECIMAL(10,4),
    previous_close  DECIMAL(18,4),
    market_state    VARCHAR(20),
    stale           BOOLEAN         NOT NULL DEFAULT FALSE,
    quote_as_of     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT chk_market_quotes_price_positive CHECK (price > 0)
);

CREATE INDEX idx_market_quotes_instrument_received
    ON market_quotes(instrument_id, received_at DESC);

COMMIT;
