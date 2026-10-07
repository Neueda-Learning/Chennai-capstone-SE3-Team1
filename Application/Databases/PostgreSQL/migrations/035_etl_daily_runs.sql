BEGIN;

-- One row per analysis day (ADR 0015). The Trade API's DailyAnalysisJob claims the day before it runs the ETL
-- (Application/ETL/etl-live/daily.py) and records how it ended, so a restart the same day does not run it again.
-- SUCCEEDED and PARTIAL (published from data already stored) close the day; FAILED is retried, up to a limit.

CREATE TABLE etl_daily_runs (
    run_day        DATE          PRIMARY KEY,
    status         VARCHAR(10)   NOT NULL,
    trigger_source VARCHAR(20)   NOT NULL,
    attempts       INT           NOT NULL DEFAULT 1,
    started_at     TIMESTAMP     NOT NULL,
    finished_at    TIMESTAMP,
    exit_code      INT,
    message        VARCHAR(500),
    CONSTRAINT chk_etl_daily_runs_status CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
    CONSTRAINT chk_etl_daily_runs_attempts CHECK (attempts > 0)
);

COMMIT;
