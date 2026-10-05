-- =============================================================================
-- DERIVED artifact, do not edit by hand.
--
-- The full DuckDB warehouse surface (warehouse.duckdb at the repo root) as the
-- loaders create it, in dependency order. Regenerate by concatenating:
--   1. Application/ETL/etl-trades/migrations/001_analytics_dimensions.sql
--      + 002_fact_trades.sql  (trade star schema; binding contract for its
--      shape is Application/Contracts/analytics-schemas/analytics-schema.sql)
--   2. Application/ETL/etl-live/analytics_schema.sql  (market price store)
-- Applied by: load_fact_trades.py schema|dims|facts and etl-live/load.py.
-- =============================================================================

-- -------------------------------------------------------------------------
-- Source: Application/ETL/etl-trades/migrations/001_analytics_dimensions.sql
-- -------------------------------------------------------------------------
-- DuckDB dialect. Applied to the warehouse file by:
--     python Application/ETL/etl-trades/load_fact_trades.py schema
--
-- The warehouse lives in DuckDB alongside the etl-live tables (daily_price and
-- friends), so a trade can be joined against the price series without crossing a
-- database boundary. Everything under analytics.* is derived from the operational
-- PostgreSQL tables and can be rebuilt from them at any time.
CREATE SCHEMA IF NOT EXISTS analytics;

-- DuckDB has no BIGSERIAL; a sequence plus a DEFAULT is the equivalent.
CREATE SEQUENCE IF NOT EXISTS analytics.seq_instrument_key START 1;
CREATE SEQUENCE IF NOT EXISTS analytics.seq_account_key START 1;

-- Loaded first, for the whole range, so every trade's created_at has a row to land
-- on. Trading-day flags are derived from the calendar only; the source has no
-- exchange holiday list.
CREATE TABLE IF NOT EXISTS analytics.dim_date (
    date_key            INTEGER      PRIMARY KEY,          -- yyyymmdd
    calendar_date       DATE         NOT NULL UNIQUE,
    day_of_week         VARCHAR      NOT NULL,
    day_of_week_number  SMALLINT     NOT NULL,             -- 1 = Monday .. 7 = Sunday
    day_of_month        SMALLINT     NOT NULL,
    week_of_year        SMALLINT     NOT NULL,
    month               SMALLINT     NOT NULL,
    month_name          VARCHAR      NOT NULL,
    quarter             SMALLINT     NOT NULL,
    year                SMALLINT     NOT NULL,
    is_weekend          BOOLEAN      NOT NULL,
    is_trading_day      BOOLEAN      NOT NULL
);

-- Mirrors public.instruments. instrument_id is the symbol (RELIANCE, TCS).
CREATE TABLE IF NOT EXISTS analytics.dim_instrument (
    instrument_key      BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_instrument_key'),
    instrument_id       VARCHAR      NOT NULL UNIQUE,
    instrument_name     VARCHAR      NOT NULL,
    is_active           BOOLEAN      NOT NULL,
    source_updated_on   TIMESTAMP,
    load_id             VARCHAR      NOT NULL,
    loaded_at           TIMESTAMP    NOT NULL DEFAULT now()
);

-- Mirrors public.clients. client_id is what orders.client_id points at, so it is the
-- natural key here; account_number is carried for reporting.
CREATE TABLE IF NOT EXISTS analytics.dim_account (
    account_key         BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_account_key'),
    client_id           BIGINT       NOT NULL UNIQUE,
    account_number      VARCHAR,
    client_name         VARCHAR      NOT NULL,
    email               VARCHAR      NOT NULL,
    account_state       VARCHAR      NOT NULL,
    client_since        TIMESTAMP    NOT NULL,
    load_id             VARCHAR      NOT NULL,
    loaded_at           TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_dim_account_state
        CHECK (account_state IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

-- -------------------------------------------------------------------------
-- Source: Application/ETL/etl-trades/migrations/002_fact_trades.sql
-- -------------------------------------------------------------------------
-- DuckDB dialect. See 001_analytics_dimensions.sql.

CREATE SEQUENCE IF NOT EXISTS analytics.seq_trade_key START 1;
CREATE SEQUENCE IF NOT EXISTS analytics.seq_dead_letter_key START 1;

-- One row per order that reached a terminal state, in whatever state it reached.
-- Rejected and cancelled orders are facts too: fill rate is FILLED / everything, and
-- the denominator has to be in this table.
--
-- Source is PostgreSQL public.order_history (the row whose new_status is terminal)
-- joined back to public.orders for the order's own fields. order_id is the natural
-- key; the UNIQUE on it is what the merge relies on.
CREATE TABLE IF NOT EXISTS analytics.fact_trades (
    trade_key           BIGINT         PRIMARY KEY DEFAULT nextval('analytics.seq_trade_key'),

    -- dimension keys
    date_key            INTEGER        NOT NULL REFERENCES analytics.dim_date(date_key),
    instrument_key      BIGINT         NOT NULL REFERENCES analytics.dim_instrument(instrument_key),
    account_key         BIGINT         NOT NULL REFERENCES analytics.dim_account(account_key),

    -- natural key
    order_id            UUID           NOT NULL UNIQUE,
    idempotency_key     VARCHAR        NOT NULL,

    -- measures and degenerate dimensions
    order_type          VARCHAR        NOT NULL,
    side                VARCHAR        NOT NULL,
    status              VARCHAR        NOT NULL,
    quantity            DECIMAL(18,4)  NOT NULL,
    price               DECIMAL(18,4)  NOT NULL,
    executed_price      DECIMAL(18,4),
    trade_value         DECIMAL(24,4)  NOT NULL,   -- quantity * coalesce(executed_price, price)
    failure_code        VARCHAR,
    failure_reason      VARCHAR,

    order_created_at    TIMESTAMP      NOT NULL,   -- the watermark column
    terminal_at         TIMESTAMP      NOT NULL,   -- order_history.event_timestamp of the terminal event

    load_id             VARCHAR        NOT NULL,
    loaded_at           TIMESTAMP      NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP      NOT NULL DEFAULT now(),

    CONSTRAINT chk_fact_trades_order_type CHECK (order_type IN ('POSITION', 'HOLDING')),
    CONSTRAINT chk_fact_trades_side       CHECK (side IN ('BUY', 'SELL')),
    CONSTRAINT chk_fact_trades_status     CHECK (status IN ('FILLED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT chk_fact_trades_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_fact_trades_price_positive    CHECK (price > 0),
    CONSTRAINT chk_fact_trades_executed_price_positive
        CHECK (executed_price IS NULL OR executed_price > 0),
    CONSTRAINT chk_fact_trades_filled_has_executed_price
        CHECK (status <> 'FILLED' OR executed_price IS NOT NULL),
    CONSTRAINT chk_fact_trades_value_recomputes
        CHECK (trade_value = quantity * COALESCE(executed_price, price))
);

-- A row that fails a quality check lands here with the check it failed and the load it
-- came from, so it can be investigated instead of being lost. The raw source row is
-- kept whole because the failing field is often not the interesting one.
CREATE TABLE IF NOT EXISTS analytics.dead_letter_trades (
    dead_letter_key     BIGINT       PRIMARY KEY DEFAULT nextval('analytics.seq_dead_letter_key'),
    load_id             VARCHAR      NOT NULL,
    order_id            UUID,                     -- NULL if the source row had no usable order_id
    check_name          VARCHAR      NOT NULL,    -- e.g. fk_instrument, positive_quantity, valid_side
    reason              VARCHAR      NOT NULL,
    source_row          JSON         NOT NULL,
    quarantined_at      TIMESTAMP    NOT NULL DEFAULT now()
);

-- One row per target table. last_watermark is the greatest orders.created_at the load
-- has processed; the next load starts after it.
CREATE TABLE IF NOT EXISTS analytics.load_watermark (
    table_name          VARCHAR      PRIMARY KEY,
    last_watermark      TIMESTAMP,
    last_load_id        VARCHAR,
    last_run_at         TIMESTAMP,
    rows_merged         INTEGER      NOT NULL DEFAULT 0,
    rows_dead_lettered  INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO analytics.load_watermark (table_name)
SELECT 'fact_trades'
WHERE NOT EXISTS (SELECT 1 FROM analytics.load_watermark WHERE table_name = 'fact_trades');

-- -------------------------------------------------------------------------
-- Source: Application/ETL/etl-live/analytics_schema.sql (market price store)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_price (
    symbol            VARCHAR(20)    NOT NULL,
    trade_date        DATE           NOT NULL,
    "interval"        VARCHAR(10)    NOT NULL,
    date_key          INTEGER        NOT NULL,
    exchange          VARCHAR(20)    NOT NULL,
    currency          VARCHAR(3),

    "open"            DECIMAL(18,4)  NOT NULL,
    "high"            DECIMAL(18,4)  NOT NULL,
    "low"             DECIMAL(18,4)  NOT NULL,
    "close"           DECIMAL(18,4)  NOT NULL,
    adj_close         DECIMAL(18,4),
    volume            BIGINT,

    price_range       DECIMAL(18,4),
    price_change      DECIMAL(18,4),
    daily_return_pct  DECIMAL(18,6),
    turnover          DECIMAL(24,4),

    synthetic         BOOLEAN        NOT NULL,
    repaired          BOOLEAN        NOT NULL,
    repairs           VARCHAR,

    run_id            VARCHAR(40)    NOT NULL,
    loaded_at         TIMESTAMP      NOT NULL,

    CONSTRAINT pk_daily_price PRIMARY KEY (symbol, trade_date, "interval")
);


CREATE TABLE IF NOT EXISTS quarantined_candle (
    run_id          VARCHAR(40)   NOT NULL,
    symbol          VARCHAR(20)   NOT NULL,
    raw_date        VARCHAR(40),
    reason          VARCHAR(40)    NOT NULL,
    detail          VARCHAR,
    candle_json     VARCHAR       NOT NULL,
    quarantined_at  TIMESTAMP      NOT NULL
);


CREATE TABLE IF NOT EXISTS load_run (
    run_id            VARCHAR(40)   NOT NULL,
    symbol            VARCHAR(20)   NOT NULL,
    repair_enabled    BOOLEAN      NOT NULL,
    candles_in        INTEGER      NOT NULL,
    rows_kept         INTEGER      NOT NULL,
    rows_repaired     INTEGER      NOT NULL,
    rows_quarantined  INTEGER      NOT NULL,
    date_from         DATE,
    date_to           DATE,
    period_return_pct DECIMAL(18,6),
    avg_volume        DECIMAL(24,4),
    loaded_at         TIMESTAMP    NOT NULL,

    CONSTRAINT pk_load_run PRIMARY KEY (run_id, symbol)
);


CREATE TABLE IF NOT EXISTS run_metric (
    run_id      VARCHAR(40)   NOT NULL,
    symbol      VARCHAR(20)   NOT NULL,
    metric      VARCHAR(40)    NOT NULL,
    label       VARCHAR(80)    NOT NULL,
    unit        VARCHAR(10)    NOT NULL,
    value       DECIMAL(24,6)  NOT NULL,
    computed_at TIMESTAMP      NOT NULL,

    CONSTRAINT pk_run_metric PRIMARY KEY (run_id, symbol, metric)
);
