BEGIN;

-- The warehouse lives in its own schema so it never collides with the
-- operational tables in public. Everything under analytics.* is derived
-- from public.* by the fact-trades load and can be rebuilt from it.
CREATE SCHEMA IF NOT EXISTS analytics;

-- Loaded first, for the whole range, so every trade's created_at has a row
-- to land on. Trading-day flags are derived from the calendar only; the
-- source has no exchange holiday list.
CREATE TABLE IF NOT EXISTS analytics.dim_date (
    date_key            INTEGER         PRIMARY KEY,          -- yyyymmdd
    calendar_date       DATE            NOT NULL UNIQUE,
    day_of_week         VARCHAR(9)      NOT NULL,
    day_of_week_number  SMALLINT        NOT NULL,             -- 1 = Monday .. 7 = Sunday
    day_of_month        SMALLINT        NOT NULL,
    week_of_year        SMALLINT        NOT NULL,
    month               SMALLINT        NOT NULL,
    month_name          VARCHAR(9)      NOT NULL,
    quarter             SMALLINT        NOT NULL,
    year                SMALLINT        NOT NULL,
    is_weekend          BOOLEAN         NOT NULL,
    is_trading_day      BOOLEAN         NOT NULL,
    CONSTRAINT chk_dim_date_key_matches_date
        CHECK (date_key = to_char(calendar_date, 'YYYYMMDD')::INTEGER)
);

-- Mirrors public.instruments. instrument_id is the symbol (RELIANCE, TCS).
CREATE TABLE IF NOT EXISTS analytics.dim_instrument (
    instrument_key      BIGSERIAL       PRIMARY KEY,
    instrument_id       VARCHAR(20)     NOT NULL UNIQUE,
    instrument_name     VARCHAR(150)    NOT NULL,
    is_active           BOOLEAN         NOT NULL,
    source_updated_on   TIMESTAMP,
    load_id             VARCHAR(40)     NOT NULL,
    loaded_at           TIMESTAMP       NOT NULL DEFAULT now()
);

-- Mirrors public.clients. client_id is what orders.client_id points at, so it
-- is the natural key here; account_number is carried for reporting.
CREATE TABLE IF NOT EXISTS analytics.dim_account (
    account_key         BIGSERIAL       PRIMARY KEY,
    client_id           BIGINT          NOT NULL UNIQUE,
    account_number      VARCHAR(34),
    client_name         VARCHAR(150)    NOT NULL,
    email               VARCHAR(150)    NOT NULL,
    account_state       VARCHAR(10)     NOT NULL,
    client_since        TIMESTAMP       NOT NULL,
    load_id             VARCHAR(40)     NOT NULL,
    loaded_at           TIMESTAMP       NOT NULL DEFAULT now(),
    CONSTRAINT chk_dim_account_state
        CHECK (account_state IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

COMMIT;
