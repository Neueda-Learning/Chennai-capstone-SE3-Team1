BEGIN;

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
