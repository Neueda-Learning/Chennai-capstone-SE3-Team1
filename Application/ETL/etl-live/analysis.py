"""ANALYSIS - turns the stored daily prices into a per-instrument analysis, a suggestion and a
next-session prediction, and publishes them to Postgres for the Trade API, the dashboard and the
assistant to read.

    python Application/ETL/etl-live/analysis.py                  # compute and print
    python Application/ETL/etl-live/analysis.py --publish        # compute and publish to Postgres
    python Application/ETL/etl-live/analysis.py --json out.json  # compute and write JSON

It reads the DuckDB store the pipeline writes (``daily_price``, interval ``1d``), read-only, and
writes two Postgres tables it owns (migration 032): ``market_analysis``, one row per instrument
replaced on every run, and ``daily_predictions``, one row per instrument per predicted session,
kept so a prediction can later be compared with what happened.

Everything here is a pure function of the closing prices except ``read_closes`` and ``publish``.

The suggestion (BUY, SELL or HOLD) is a score from three published rules, each of which adds a
sentence to ``reasons``:

    trend      +40 when the 20-day average is above the 50-day and the close is above the 20-day,
               -40 for the mirror image, 0 when they disagree
    momentum   the 20-day return in percent, doubled, capped at +/-30
    RSI(14)    -20 above 70 (stretched after a run-up), +20 below 30 (stretched after a fall)

A score of 30 or more is BUY, -30 or less SELL, otherwise HOLD; |score| >= 60 is HIGH confidence,
>= 30 MEDIUM, else LOW. Fewer than 60 sessions is INSUFFICIENT_DATA and no suggestion.

The prediction is a drift-and-volatility model, not a forecast of direction: the expected log
return is half the mean of the last 20 daily log returns (shrunk towards zero, because short-term
drift barely persists), the spread is the standard deviation of the last 60, and the chance of an
up session is kept between 40% and 60% because daily direction is close to a coin flip.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

MODEL = "trend-momentum-rsi/drift-vol v1"
MIN_SESSIONS = 60
SHORT_WINDOW = 20
LONG_WINDOW = 50
RSI_PERIOD = 14
DRIFT_WINDOW = 20
VOL_WINDOW = 60
DRIFT_SHRINK = 0.5
PROB_FLOOR, PROB_CEILING = 0.40, 0.60
Z68, Z90 = 1.0, 1.645

log = logging.getLogger("analysis")


@dataclass
class Analysis:
    symbol: str
    as_of: date | None
    status: str
    observations: int
    close: float | None = None
    sma_20: float | None = None
    sma_50: float | None = None
    rsi_14: float | None = None
    return_20d_pct: float | None = None
    volatility_pct: float | None = None
    max_drawdown_pct: float | None = None
    trend: str | None = None
    score: float | None = None
    suggestion: str | None = None
    confidence: str | None = None
    reasons: list[str] = field(default_factory=list)
    summary: str = ""


@dataclass
class Prediction:
    symbol: str
    as_of: date
    for_date: date
    last_close: float
    predicted_close: float
    low_68: float
    high_68: float
    low_90: float
    high_90: float
    prob_up: float
    expected_return_pct: float


# ---- pure helpers


def app_symbol(warehouse_symbol: str) -> str:
    """RELIANCE.NS -> RELIANCE. The Trade API's instruments carry no exchange suffix."""
    return warehouse_symbol.split(".", 1)[0].upper()


def sma(values: list[float], window: int) -> float:
    return sum(values[-window:]) / window


def rsi(closes: list[float], period: int = RSI_PERIOD) -> float | None:
    if len(closes) <= period:
        return None
    changes = [b - a for a, b in zip(closes[-period - 1:-1], closes[-period:])]
    gains = sum(c for c in changes if c > 0) / period
    losses = sum(-c for c in changes if c < 0) / period
    if losses == 0:
        return 100.0 if gains > 0 else 50.0
    return 100 - 100 / (1 + gains / losses)


def stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def log_returns(closes: list[float]) -> list[float]:
    return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]


def max_drawdown_pct(closes: list[float]) -> float:
    peak, worst = closes[0], 0.0
    for c in closes:
        peak = max(peak, c)
        worst = min(worst, (c / peak - 1) * 100)
    return worst


def next_session(day: date) -> date:
    following = day + timedelta(days=1)
    while following.weekday() >= 5:
        following += timedelta(days=1)
    return following


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _r(value: float | None, places: int = 2) -> float | None:
    return None if value is None else round(value, places)


# ---- analysis


def analyse(symbol: str, closes: list[float], as_of: date | None) -> Analysis:
    """The analysis and suggestion for one instrument, from its daily closes, oldest first."""
    if len(closes) < MIN_SESSIONS or as_of is None:
        return Analysis(symbol=symbol, as_of=as_of, status="INSUFFICIENT_DATA", observations=len(closes),
                        close=_r(closes[-1]) if closes else None,
                        summary=f"Only {len(closes)} daily closes are stored for {symbol}; the analysis "
                                f"needs {MIN_SESSIONS} before it suggests anything.")

    close = closes[-1]
    s20, s50 = sma(closes, SHORT_WINDOW), sma(closes, LONG_WINDOW)
    r14 = rsi(closes)
    ret20 = (close / closes[-SHORT_WINDOW - 1] - 1) * 100
    vol = stdev(log_returns(closes[-SHORT_WINDOW - 1:])) * math.sqrt(252) * 100
    reasons: list[str] = []

    if s20 > s50 and close > s20:
        trend, trend_points = "UP", 40
        reasons.append(f"Uptrend: the 20-day average ({s20:.2f}) is above the 50-day ({s50:.2f}) "
                       f"and the close ({close:.2f}) is above the 20-day.")
    elif s20 < s50 and close < s20:
        trend, trend_points = "DOWN", -40
        reasons.append(f"Downtrend: the 20-day average ({s20:.2f}) is below the 50-day ({s50:.2f}) "
                       f"and the close ({close:.2f}) is below the 20-day.")
    else:
        trend, trend_points = "FLAT", 0
        reasons.append(f"No clear trend: the 20-day average ({s20:.2f}), the 50-day ({s50:.2f}) "
                       f"and the close ({close:.2f}) disagree.")

    momentum_points = max(-30.0, min(30.0, ret20 * 2))
    reasons.append(f"Momentum: {ret20:+.2f}% over 20 sessions ({momentum_points:+.0f} points).")

    rsi_points = 0
    if r14 is not None and r14 > 70:
        rsi_points = -20
        reasons.append(f"RSI(14) is {r14:.0f}, above 70: stretched after a run-up, so the score is cut.")
    elif r14 is not None and r14 < 30:
        rsi_points = 20
        reasons.append(f"RSI(14) is {r14:.0f}, below 30: stretched after a fall, so the score is raised.")
    elif r14 is not None:
        reasons.append(f"RSI(14) is {r14:.0f}, between 30 and 70: neither stretched nor washed out.")

    score = trend_points + momentum_points + rsi_points
    suggestion = "BUY" if score >= 30 else "SELL" if score <= -30 else "HOLD"
    confidence = "HIGH" if abs(score) >= 60 else "MEDIUM" if abs(score) >= 30 else "LOW"
    summary = (f"{suggestion} ({confidence.lower()} confidence, score {score:+.0f}): "
               f"{trend.lower()} trend, {ret20:+.1f}% over 20 sessions, annualised volatility {vol:.0f}%.")

    return Analysis(symbol=symbol, as_of=as_of, status="OK", observations=len(closes), close=_r(close),
                    sma_20=_r(s20), sma_50=_r(s50), rsi_14=_r(r14, 1), return_20d_pct=_r(ret20),
                    volatility_pct=_r(vol), max_drawdown_pct=_r(max_drawdown_pct(closes[-252:])),
                    trend=trend, score=_r(score, 1), suggestion=suggestion, confidence=confidence,
                    reasons=reasons, summary=summary)


def predict(symbol: str, closes: list[float], as_of: date) -> Prediction | None:
    """The next session's expected close and ranges, or None with too little history."""
    returns = log_returns(closes)
    if len(closes) < MIN_SESSIONS or len(returns) < VOL_WINDOW:
        return None
    drift = DRIFT_SHRINK * sum(returns[-DRIFT_WINDOW:]) / DRIFT_WINDOW
    sigma = stdev(returns[-VOL_WINDOW:])
    close = closes[-1]
    prob_up = 0.5 if sigma == 0 else normal_cdf(drift / sigma)
    prob_up = max(PROB_FLOOR, min(PROB_CEILING, prob_up))
    return Prediction(symbol=symbol, as_of=as_of, for_date=next_session(as_of), last_close=round(close, 2),
                      predicted_close=round(close * math.exp(drift), 2),
                      low_68=round(close * math.exp(drift - Z68 * sigma), 2),
                      high_68=round(close * math.exp(drift + Z68 * sigma), 2),
                      low_90=round(close * math.exp(drift - Z90 * sigma), 2),
                      high_90=round(close * math.exp(drift + Z90 * sigma), 2),
                      prob_up=round(prob_up, 4), expected_return_pct=round((math.exp(drift) - 1) * 100, 3))


def compute(series: dict[str, tuple[list[float], date | None]]) -> tuple[list[Analysis], list[Prediction]]:
    analyses, predictions = [], []
    for symbol in sorted(series):
        closes, as_of = series[symbol]
        analyses.append(analyse(symbol, closes, as_of))
        prediction = predict(symbol, closes, as_of) if as_of else None
        if prediction:
            predictions.append(prediction)
    return analyses, predictions


# ---- reading the store


def read_closes(connection) -> dict[str, tuple[list[float], date | None]]:
    """Daily closes per app symbol, oldest first. An NSE series is preferred over a BSE one."""
    rows = connection.execute(
        'SELECT symbol, trade_date, "close" FROM daily_price '
        "WHERE \"interval\" = '1d' ORDER BY symbol, trade_date").fetchall()
    by_listing: dict[str, list[tuple[date, float]]] = {}
    for listing, day, close in rows:
        by_listing.setdefault(listing, []).append((day, float(close)))

    chosen: dict[str, str] = {}
    for listing in by_listing:
        symbol = app_symbol(listing)
        current = chosen.get(symbol)
        if current is None or (listing.endswith(".NS") and not current.endswith(".NS")) \
                or (listing.endswith(".NS") == current.endswith(".NS")
                    and len(by_listing[listing]) > len(by_listing[current])):
            chosen[symbol] = listing
    return {symbol: ([c for _, c in by_listing[listing]], by_listing[listing][-1][0] if by_listing[listing] else None)
            for symbol, listing in chosen.items()}


def merge_newer(series: dict[str, tuple[list[float], date | None]],
                platform: dict[str, list[tuple[date, float]]]) -> dict[str, tuple[list[float], date | None]]:
    """Extends each warehouse series with the platform's daily closes dated after it ends.

    The warehouse is refreshed when the pipeline runs; the Trade API stores yesterday's candle for any
    instrument a customer looks at. Appending only later dates keeps the warehouse authoritative for the
    past and lets the prediction be for the next session rather than for the day after the last load.
    """
    merged = dict(series)
    for symbol, rows in platform.items():
        closes, last = merged.get(symbol, ([], None))
        newer = [(d, c) for d, c in sorted(rows) if last is None or d > last]
        if newer:
            merged[symbol] = (closes + [c for _, c in newer], newer[-1][0])
    return merged


def read_platform_closes(cfg) -> dict[str, list[tuple[date, float]]]:
    """Daily closes the Trade API has stored in Postgres (daily_candles), synthetic candles excluded."""
    out: dict[str, list[tuple[date, float]]] = {}
    for symbol, day, close in cfg.rows(
            "SELECT instrument_id, trade_date, close_price FROM daily_candles "
            "WHERE NOT synthetic ORDER BY instrument_id, trade_date"):
        out.setdefault(symbol, []).append((date.fromisoformat(day), float(close)))
    return out


# ---- publishing


def _lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(float(value)) if isinstance(value, float) else str(value)
    return "'" + str(value).replace("'", "''") + "'"


def publish_sql(analyses: list[Analysis], predictions: list[Prediction], run_id: str, generated_at: datetime) -> str:
    """One transaction: replace market_analysis, upsert daily_predictions. Unknown instruments are skipped."""
    stamp = _lit(generated_at.strftime("%Y-%m-%d %H:%M:%S"))
    out = ["BEGIN;", "DELETE FROM market_analysis;"]
    if analyses:
        values = ",\n".join(
            "(" + ", ".join([
                _lit(a.symbol), _lit(a.as_of.isoformat() if a.as_of else None), _lit(a.status), str(a.observations),
                _lit(a.close), _lit(a.sma_20), _lit(a.sma_50), _lit(a.rsi_14), _lit(a.return_20d_pct),
                _lit(a.volatility_pct), _lit(a.max_drawdown_pct), _lit(a.trend), _lit(a.score),
                _lit(a.suggestion), _lit(a.confidence), _lit(json.dumps(a.reasons)), _lit(a.summary),
                _lit(MODEL), _lit(run_id), stamp]) + ")"
            for a in analyses)
        out.append(
            "INSERT INTO market_analysis (instrument_id, as_of, status, observations, close_price, sma_20, sma_50, "
            "rsi_14, return_20d_pct, volatility_pct, max_drawdown_pct, trend, score, suggestion, confidence, "
            "reasons, summary, model, run_id, generated_at)\n"
            "SELECT v.instrument_id, CAST(v.as_of AS DATE), v.status, CAST(v.observations AS INT), "
            + ", ".join(f"CAST(v.{c} AS NUMERIC)" for c in (
                "close_price", "sma_20", "sma_50", "rsi_14", "return_20d_pct", "volatility_pct",
                "max_drawdown_pct")) + ", "
            "CAST(v.trend AS VARCHAR), CAST(v.score AS NUMERIC), CAST(v.suggestion AS VARCHAR), "
            "CAST(v.confidence AS VARCHAR), v.reasons, v.summary, v.model, v.run_id, "
            "CAST(v.generated_at AS TIMESTAMP)\n"
            "FROM (VALUES\n" + values + "\n) AS v(instrument_id, as_of, status, observations, close_price, sma_20, "
            "sma_50, rsi_14, return_20d_pct, volatility_pct, max_drawdown_pct, trend, score, suggestion, confidence, "
            "reasons, summary, model, run_id, generated_at)\n"
            "WHERE v.instrument_id IN (SELECT instrument_id FROM instruments);")
    if predictions:
        values = ",\n".join(
            "(" + ", ".join([
                _lit(p.symbol), _lit(p.for_date.isoformat()), _lit(p.as_of.isoformat()), _lit(p.last_close),
                _lit(p.predicted_close), _lit(p.low_68), _lit(p.high_68), _lit(p.low_90), _lit(p.high_90),
                _lit(p.prob_up), _lit(p.expected_return_pct), _lit(MODEL), _lit(run_id), stamp]) + ")"
            for p in predictions)
        out.append(
            "INSERT INTO daily_predictions (instrument_id, for_date, as_of, last_close, predicted_close, low_68, "
            "high_68, low_90, high_90, prob_up, expected_return_pct, model, run_id, generated_at)\n"
            "SELECT v.instrument_id, CAST(v.for_date AS DATE), CAST(v.as_of AS DATE), "
            + ", ".join(f"CAST(v.{c} AS NUMERIC)" for c in (
                "last_close", "predicted_close", "low_68", "high_68", "low_90", "high_90", "prob_up",
                "expected_return_pct")) + ", "
            "v.model, v.run_id, CAST(v.generated_at AS TIMESTAMP)\n"
            "FROM (VALUES\n" + values + "\n) AS v(instrument_id, for_date, as_of, last_close, predicted_close, "
            "low_68, high_68, low_90, high_90, prob_up, expected_return_pct, model, run_id, generated_at)\n"
            "WHERE v.instrument_id IN (SELECT instrument_id FROM instruments)\n"
            "ON CONFLICT (instrument_id, for_date) DO UPDATE SET as_of = EXCLUDED.as_of, "
            "last_close = EXCLUDED.last_close, predicted_close = EXCLUDED.predicted_close, "
            "low_68 = EXCLUDED.low_68, high_68 = EXCLUDED.high_68, low_90 = EXCLUDED.low_90, "
            "high_90 = EXCLUDED.high_90, prob_up = EXCLUDED.prob_up, "
            "expected_return_pct = EXCLUDED.expected_return_pct, model = EXCLUDED.model, "
            "run_id = EXCLUDED.run_id, generated_at = EXCLUDED.generated_at;")
    out.append("COMMIT;")
    return "\n".join(out) + "\n"


def platform_db():
    """The platform's Postgres settings (vault, then .env, then defaults), via the resolver apply_db.py uses."""
    scripts = Path(__file__).resolve().parents[3] / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from db_config import DbConfig  # noqa: E402

    return DbConfig.resolve()


def publish(cfg, sql: str) -> None:
    cfg.run_or_die("publishing the analysis to " + cfg.describe(), script=sql)


# ---- command line


def _open_store(db_path: str):
    try:
        if __package__:
            from . import store as store_module
        else:
            import store as store_module  # run as a script from this folder
        return store_module.connect(db_path).connection
    except ImportError:
        import duckdb
        return duckdb.connect(db_path, read_only=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analysis, suggestions and daily predictions from the store")
    parser.add_argument("--db", default=str(Path(__file__).resolve().parents[3] / "warehouse.duckdb"),
                        help="the DuckDB store (default: warehouse.duckdb at the repository root)")
    parser.add_argument("--publish", action="store_true", help="write the results to Postgres")
    parser.add_argument("--json", help="also write the results to this JSON file")
    parser.add_argument("--warehouse-only", action="store_true",
                        help="with --publish, do not extend the series with the Trade API's newer daily candles")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    if not Path(args.db).is_file():
        log.error("no store at %s; run the pipeline first", args.db)
        return 1
    connection = _open_store(args.db)
    series = read_closes(connection)
    cfg = platform_db() if args.publish else None
    if cfg is not None and not args.warehouse_only:
        platform = read_platform_closes(cfg)
        series = merge_newer(series, platform)
        log.info("extended with the Trade API's daily candles for %d instruments", len(platform))
    analyses, predictions = compute(series)
    generated_at = datetime.now()
    run_id = "analysis-" + generated_at.strftime("%Y%m%dT%H%M%S")

    ok = [a for a in analyses if a.status == "OK"]
    counts = {s: sum(1 for a in ok if a.suggestion == s) for s in ("BUY", "HOLD", "SELL")}
    latest = max((a.as_of for a in ok if a.as_of), default=None)
    log.info("%d instruments analysed (%d with too little history), data to %s: %s",
             len(analyses), len(analyses) - len(ok), latest, counts)

    if args.json:
        Path(args.json).write_text(json.dumps({
            "model": MODEL, "runId": run_id, "generatedAt": generated_at.isoformat(timespec="seconds"),
            "analyses": [asdict(a) for a in analyses], "predictions": [asdict(p) for p in predictions]},
            default=str, indent=2), encoding="utf-8")
        log.info("wrote %s", args.json)
    if args.publish:
        publish(cfg, publish_sql(analyses, predictions, run_id, generated_at))
        log.info("published %d analyses and %d predictions (run %s)", len(analyses), len(predictions), run_id)
    else:
        for a in sorted(ok, key=lambda a: -(a.score or 0))[:10]:
            log.info("  %-12s %s", a.symbol, a.summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
