-- DuckDB dialect. Applied to the warehouse file by:
--     python fact-trades/load_fact_trades.py schema
--
-- The warehouse lives in DuckDB alongside the ETL_Analysis tables (daily_price and
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
