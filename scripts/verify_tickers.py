"""Check that every active instrument in the seed returns a price from Fauxnance.

Costs one request per 25 symbols (two for the 50-symbol universe). Run it after changing
seeds/040_instruments.csv, before the daily quota is spent on tickers that never price:

    python scripts/verify_tickers.py
"""
from __future__ import annotations

import csv
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import trustme_secrets as trustme

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db_config import REPO_ROOT, SEED_DIR  # noqa: E402

BATCH = 25
SUFFIX = ".NS"


def main() -> int:
    trustme.use_key_file(str(REPO_ROOT / "leapcapstoneteam1-720d03.TM"))
    base = trustme.get("Fauxnance_Endpoint").rstrip("/")
    key = trustme.get("Fauxnance")

    with open(SEED_DIR / "040_instruments.csv", newline="", encoding="utf-8") as fh:
        active = [r["instrument_id"] for r in csv.DictReader(fh) if r["active"].lower() == "true"]

    priced, unpriced = [], []
    for start in range(0, len(active), BATCH):
        chunk = active[start:start + BATCH]
        joined = ",".join(s + SUFFIX for s in chunk)
        req = urllib.request.Request(
            base + "/quotes?symbols=" + urllib.parse.quote(joined, safe=","),
            headers={"x-api-key": key})
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.load(resp)
        got = {}
        for entry in body["data"]["quotes"]:
            got[entry["symbol"]] = (entry.get("quote") or {}).get("price")
        for symbol in chunk:
            (priced if got.get(symbol + SUFFIX) else unpriced).append(symbol)

    print(f"{len(priced)} of {len(active)} active instruments returned a price")
    if unpriced:
        print("NO PRICE (set active=false or replace):", ", ".join(unpriced))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
