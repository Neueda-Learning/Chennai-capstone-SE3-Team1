"""DAILY - one day's ETL for the trading app: refresh the warehouse from Fauxnance, then publish the analysis.

    python Application/ETL/etl-live/daily.py --day 2026-10-07            # what the Trade API runs once a day
    python Application/ETL/etl-live/daily.py --day 2026-10-07 --skip-refresh

The Trade API's DailyAnalysisJob runs this once per analysis day (ADR 0015) and records the outcome in
Postgres, so restarting the stack the same day does not run it again. This module adds a second guard of its
own: every candle response it fetches is cached under ``.cache/daily/<day>/``, so a re-run for the same day
reads the cache and spends no Fauxnance quota. (The live extractor's own cache is keyed without a date and
would serve the first response it ever saw, for ever; that is why it is bypassed here.)

Exit codes, read by the Trade API:

    0  the warehouse was refreshed and the analysis published
    3  the refresh failed or was skipped; the analysis was published from the data already stored
    1  the analysis could not be published
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
CACHE_ROOT = HERE / ".cache" / "daily"
KEEP_DAYS = 7

EXIT_OK = 0
EXIT_ANALYSIS_FAILED = 1
EXIT_PUBLISHED_FROM_CACHE = 3

log = logging.getLogger("daily")


def _package():
    """This folder as the ETL_Analysis package (its modules use relative imports), as the tests register it."""
    if "ETL_Analysis" not in sys.modules:
        spec = importlib.util.spec_from_file_location("ETL_Analysis", HERE / "__init__.py",
                                                      submodule_search_locations=[str(HERE)])
        module = importlib.util.module_from_spec(spec)
        sys.modules["ETL_Analysis"] = module
        spec.loader.exec_module(module)
    return sys.modules["ETL_Analysis"]


def day_cache(day: date, root: Path = CACHE_ROOT) -> Path:
    return root / day.isoformat()


def cached_symbols(day: date, root: Path = CACHE_ROOT) -> set[str]:
    folder = day_cache(day, root)
    return {p.stem.removeprefix("candles-") for p in folder.glob("candles-*.json")} if folder.is_dir() else set()


def dated_extract(day: date, live_extract, root: Path = CACHE_ROOT):
    """An extract function that fetches each symbol at most once per day and serves the day's copy after that."""
    folder = day_cache(day, root)

    def extract(symbol: str, interval: str | None = None) -> dict:
        safe = symbol.replace("/", "-").replace(":", "-")
        path = folder / f"candles-{safe}{'-' + interval if interval else ''}.json"
        if path.is_file():
            log.debug("day cache hit: %s", symbol)
            return json.loads(path.read_text(encoding="utf-8"))
        payload = live_extract(symbol, use_cache=False, interval=interval) if interval else \
            live_extract(symbol, use_cache=False)
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    return extract


def prune(today: date, root: Path = CACHE_ROOT, keep_days: int = KEEP_DAYS) -> int:
    """Deletes day caches older than keep_days. Returns how many were removed."""
    removed = 0
    if not root.is_dir():
        return removed
    for folder in root.iterdir():
        try:
            day = date.fromisoformat(folder.name)
        except ValueError:
            continue
        if day < today - timedelta(days=keep_days):
            shutil.rmtree(folder, ignore_errors=True)
            removed += 1
    return removed


def refresh_warehouse(day: date, db: str, limit: int | None = None, live_extract=None,
                      root: Path = CACHE_ROOT) -> tuple[bool, str]:
    """Pulls the symbol universe (from the day cache where already fetched) and loads it into the warehouse."""
    _package()
    from ETL_Analysis import pipeline, symbols  # noqa: E402  (needs the package registered first)

    universe = symbols.filter_symbols(symbols.load_symbol_file(None), limit=limit)
    already = cached_symbols(day, root)
    try:
        symbols.plan_pull(universe, cached=len([s for s in universe if s in already]))
    except symbols.QuotaTooLow as exc:
        return False, str(exc)
    if live_extract is None:
        try:
            from ETL_Analysis.extract_live import extract as live_extract  # noqa: E402
        except Exception as exc:  # missing key, missing requests, vault not readable
            return False, f"live extract unavailable: {exc}"
    code = pipeline.run(universe, extract_fn=dated_extract(day, live_extract, root), db_path=db)
    fetched = len(cached_symbols(day, root))
    if code != 0:
        return False, f"pipeline exited {code} ({fetched} of {len(universe)} symbols in today's cache)"
    return True, f"{fetched} of {len(universe)} symbols for {day}"


def publish_analysis(db: str) -> int:
    _package()
    from ETL_Analysis import analysis  # noqa: E402

    return analysis.main(["--publish", "--db", db])


def main(argv: list[str] | None = None, refresh=refresh_warehouse, publish=publish_analysis) -> int:
    parser = argparse.ArgumentParser(description="One day's ETL: refresh the warehouse, publish the analysis")
    parser.add_argument("--day", type=date.fromisoformat, default=date.today(),
                        help="the analysis day this run is for (the Trade API passes it); keys the cache")
    parser.add_argument("--db", default=str(REPO_ROOT / "warehouse.duckdb"))
    parser.add_argument("--skip-refresh", action="store_true", help="publish from the stored data only")
    parser.add_argument("--limit", type=int, default=None, help="pull only the first N symbols")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")

    removed = prune(args.day)
    if removed:
        log.info("removed %d old day cache(s)", removed)

    refreshed = False
    if args.skip_refresh:
        log.info("refresh skipped; publishing from the stored data")
    else:
        try:
            refreshed, message = refresh(args.day, args.db, args.limit)
        except Exception as exc:
            refreshed, message = False, f"refresh failed: {exc}"
        (log.info if refreshed else log.warning)("warehouse: %s", message)

    try:
        published = publish(args.db) == 0
    except Exception as exc:
        log.error("analysis failed: %s", exc)
        published = False
    if not published:
        log.error("analysis was not published")
        return EXIT_ANALYSIS_FAILED
    return EXIT_OK if refreshed else EXIT_PUBLISHED_FROM_CACHE


if __name__ == "__main__":
    sys.exit(main())
