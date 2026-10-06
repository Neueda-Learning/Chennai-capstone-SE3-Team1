BEGIN;

-- Watchlists and price alerts (ADR 0005, 0010). instrument_id references the instrument reference
-- data; nothing is copied. A watchlist entry is not a position, so there is no link to holdings.

CREATE TABLE watchlists (
    watchlist_id UUID         PRIMARY KEY,
    account_id   BIGINT       NOT NULL REFERENCES clients(client_id),
    name         VARCHAR(60)  NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_watchlists_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX uq_watchlists_account_name ON watchlists (account_id, lower(name));

CREATE TABLE watchlist_instruments (
    watchlist_id  UUID         NOT NULL REFERENCES watchlists(watchlist_id) ON DELETE CASCADE,
    instrument_id VARCHAR(20)  NOT NULL REFERENCES instruments(instrument_id),
    added_at      TIMESTAMP    NOT NULL DEFAULT now(),
    PRIMARY KEY (watchlist_id, instrument_id)
);

-- state is ARMED until a quote crosses the threshold, then FIRED until the customer re-arms it.
-- delivery_state is what Notifications answered when the fired alert was handed over; NULL until then.
-- fired_at is part of the delivery id, so a re-fire after a re-arm is a different message.

CREATE TABLE price_alerts (
    alert_id       UUID           PRIMARY KEY,
    account_id     BIGINT         NOT NULL REFERENCES clients(client_id),
    instrument_id  VARCHAR(20)    NOT NULL REFERENCES instruments(instrument_id),
    threshold      NUMERIC(18,4)  NOT NULL,
    direction      VARCHAR(5)     NOT NULL,
    state          VARCHAR(10)    NOT NULL DEFAULT 'ARMED',
    delivery_state VARCHAR(20),
    fired_at       TIMESTAMP,
    fired_price    NUMERIC(18,4),
    created_at     TIMESTAMP      NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP      NOT NULL DEFAULT now(),
    CONSTRAINT chk_price_alerts_threshold CHECK (threshold > 0),
    CONSTRAINT chk_price_alerts_direction CHECK (direction IN ('ABOVE', 'BELOW')),
    CONSTRAINT chk_price_alerts_state CHECK (state IN ('ARMED', 'FIRED', 'DISABLED')),
    CONSTRAINT chk_price_alerts_delivery_state
        CHECK (delivery_state IS NULL
               OR delivery_state IN ('QUEUED', 'PENDING_CHANNEL', 'REJECTED', 'DELIVERY_FAILED'))
);

-- The per-quote lookup: every quote reads only the armed alerts for its own symbol.
CREATE INDEX idx_price_alerts_symbol_armed ON price_alerts (instrument_id) WHERE state = 'ARMED';
CREATE INDEX idx_price_alerts_account_created ON price_alerts (account_id, created_at DESC);
-- Crash recovery: fired alerts that were never handed to Notifications.
CREATE INDEX idx_price_alerts_undelivered ON price_alerts (fired_at)
    WHERE state = 'FIRED' AND delivery_state IS NULL;

COMMIT;
