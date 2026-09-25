"""Generate a batch of realistic orders in the trade database.

    cd fact-trades && python -m simulate_orders            # 20 orders, default mix
    python fact-trades/simulate_orders.py --count 50       # same thing from the repo root

Every run writes brand-new orders: uuid4 order_ids, unique idempotency keys,
and created_at timestamps that carry on after the newest order already in the
table, so nothing is ever overwritten and each run is picked up by the next
fact_trades load. Each order gets its orders row and its order_history trail
(CREATED -> NEW, then the terminal event) exactly as the platform would write
them.

The mix includes orders the fact_trades load must refuse. They all satisfy the
database's own constraints, so only the load's checks can catch them:

    late_creation       terminal event stamped before the order was created
    unknown_instrument  a newly listed symbol the dimensions have not seen yet
    unknown_client      a brand-new client the dimensions have not seen yet

The last two clear on the next `load_fact_trades.py dims` plus a `--since`
replay; the first is a genuine data fault that stays dead-lettered.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from db_config import DbConfig, DbError, add_connection_args, quote_literal  # noqa: E402

FAILURE_CODES = {
    "INSUFFICIENT_FUNDS": "wallet balance cannot cover the order value",
    "INSTRUMENT_INACTIVE": "instrument is delisted",
    "PRICE_OUT_OF_BAND": "limit price outside the exchange's daily band",
    "RISK_LIMIT": "order would breach the client's exposure limit",
}
BAD_KINDS = ("late_creation", "unknown_instrument", "unknown_client")
FIRST_NAMES = ["Ishaan", "Meera", "Kabir", "Ananya", "Vihaan", "Saanvi", "Arjun", "Riya"]
LAST_NAMES = ["Nair", "Kulkarni", "Bose", "Reddy", "Menon", "Chopra", "Pillai", "Desai"]
NEW_SYMBOLS = ["ZOMATO", "NYKAA", "PAYTM", "DELHIVERY", "MAPMYINDIA", "IRCTC", "LICI", "TATATECH"]


def say(msg=""):
    print(msg, flush=True)


def ts(value: datetime) -> str:
    return quote_literal(value.strftime("%Y-%m-%d %H:%M:%S.%f")) + "::timestamp"


def money(value) -> str:
    return str(Decimal(value).quantize(Decimal("0.0001")))


class Simulation:
    def __init__(self, cfg: DbConfig, rng: random.Random, window_minutes: int):
        self.cfg = cfg
        self.rng = rng
        self.window = timedelta(minutes=window_minutes)
        self.statements = []
        self.summary = []
        self.clients = []
        self.instruments = []
        self.prices = {}

    # ------------------------------------------------------------ reference data

    def load_reference(self):
        self.clients = [
            (int(r[0]), r[1]) for r in self.cfg.rows(
                "SELECT client_id, name FROM clients WHERE account_state = 'ACTIVE' ORDER BY client_id;"
            )
        ]
        self.instruments = [
            r[0] for r in self.cfg.rows("SELECT instrument_id FROM instruments WHERE active ORDER BY 1;")
        ]
        if not self.clients or not self.instruments:
            raise DbError("need at least one ACTIVE client and one active instrument to simulate against")

        for r in self.cfg.rows(
            "SELECT instrument_id, avg(price) FROM orders GROUP BY instrument_id;"
        ):
            self.prices[r[0]] = Decimal(r[1])
        for symbol in self.instruments:
            self.prices.setdefault(symbol, Decimal(self.rng.randint(120, 4200)))

        newest = self.cfg.scalar("SELECT max(created_at) FROM orders;")
        now = datetime.now()
        floor = now - self.window
        if newest:
            last = datetime.fromisoformat(newest) + timedelta(seconds=1)
            floor = max(floor, last)
        if floor >= now:
            floor = now - timedelta(seconds=30)
        self.start, self.end = floor, now

    # ------------------------------------------------------------ helpers

    def _when(self) -> datetime:
        span = (self.end - self.start).total_seconds()
        return self.start + timedelta(seconds=self.rng.uniform(0, max(span, 1)))

    def _price_for(self, symbol) -> Decimal:
        base = self.prices.get(symbol, Decimal(1000))
        drift = Decimal(self.rng.uniform(-0.03, 0.03))
        return (base * (1 + drift)).quantize(Decimal("0.0001"))

    def _emit_order(self, *, client_id, instrument_id, status, created, terminal=None,
                    executed=None, failure=None, label=None):
        order_id = str(uuid.uuid4())
        side = self.rng.choice(["BUY", "SELL"])
        order_type = self.rng.choice(["HOLDING", "HOLDING", "POSITION"])
        quantity = self.rng.choice([1, 2, 5, 10, 15, 20, 25, 50, 100])
        price = self._price_for(instrument_id)
        idem = "sim-" + uuid.uuid4().hex[:12]
        updated = terminal if terminal and terminal >= created else created

        self.statements.append(
            "INSERT INTO orders (order_id, client_id, account_id, instrument_id, order_type, side, "
            "quantity, price, executed_price, status, idempotency_key, created_at, updated_at) VALUES ("
            + quote_literal(order_id) + "::uuid, " + str(client_id) + ", " + str(client_id) + ", "
            + quote_literal(instrument_id) + ", " + quote_literal(order_type) + ", " + quote_literal(side) + ", "
            + str(quantity) + ", " + money(price) + ", "
            + (money(executed) if executed is not None else "NULL") + ", "
            + quote_literal(status) + ", " + quote_literal(idem) + ", " + ts(created) + ", " + ts(updated) + ");"
        )
        self.statements.append(
            "INSERT INTO order_history (order_id, event_type, previous_status, new_status, request_id, event_timestamp, created_at) "
            "VALUES (" + quote_literal(order_id) + "::uuid, 'CREATED', NULL, 'NEW', "
            + quote_literal("req-" + idem[4:]) + ", " + ts(created) + ", " + ts(created) + ");"
        )
        if terminal is not None:
            code, reason = failure if failure else (None, None)
            self.statements.append(
                "INSERT INTO order_history (order_id, event_type, previous_status, new_status, external_status, "
                "external_order_id, request_id, failure_code, failure_reason, event_timestamp, created_at) VALUES ("
                + quote_literal(order_id) + "::uuid, " + quote_literal(status) + ", 'NEW', " + quote_literal(status) + ", "
                + quote_literal(status) + ", " + quote_literal("EXT-" + idem[4:].upper()) + ", "
                + quote_literal("req-" + idem[4:]) + ", "
                + (quote_literal(code) if code else "NULL") + ", "
                + (quote_literal(reason) if reason else "NULL") + ", "
                + ts(terminal) + ", " + ts(terminal) + ");"
            )
        self.summary.append((label or status, order_id, instrument_id, side, quantity, money(price), status))
        return order_id

    # ------------------------------------------------------------ order kinds

    def filled(self):
        created = self._when()
        symbol = self.rng.choice(self.instruments)
        price = self._price_for(symbol)
        slip = Decimal(self.rng.uniform(-0.002, 0.002))
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=symbol, status="FILLED",
            created=created, terminal=created + timedelta(seconds=self.rng.uniform(0.5, 90)),
            executed=(price * (1 + slip)).quantize(Decimal("0.0001")),
        )

    def rejected(self):
        created = self._when()
        code = self.rng.choice(list(FAILURE_CODES))
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=self.rng.choice(self.instruments),
            status="REJECTED", created=created,
            terminal=created + timedelta(seconds=self.rng.uniform(0.1, 5)),
            failure=(code, FAILURE_CODES[code]),
        )

    def cancelled(self):
        created = self._when()
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=self.rng.choice(self.instruments),
            status="CANCELLED", created=created,
            terminal=created + timedelta(seconds=self.rng.uniform(5, 600)),
        )

    def open(self):
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=self.rng.choice(self.instruments),
            status="NEW", created=self._when(), label="NEW (still open)",
        )

    def bad_late_creation(self):
        created = self._when()
        symbol = self.rng.choice(self.instruments)
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=symbol, status="FILLED",
            created=created, terminal=created - timedelta(minutes=self.rng.randint(2, 45)),
            executed=self._price_for(symbol), label="BAD late_creation",
        )

    def bad_unknown_instrument(self):
        existing = {r[0] for r in self.cfg.rows("SELECT instrument_id FROM instruments;")}
        candidates = [s for s in NEW_SYMBOLS if s not in existing] or [
            "NEW" + uuid.uuid4().hex[:6].upper()
        ]
        symbol = self.rng.choice(candidates)
        self.statements.append(
            "INSERT INTO instruments (instrument_id, instrument_name, active, updated_on) VALUES ("
            + quote_literal(symbol) + ", " + quote_literal(symbol.title() + " Ltd (" + uuid.uuid4().hex[:4] + ")")
            + ", TRUE, now()) ON CONFLICT (instrument_id) DO NOTHING;"
        )
        self.prices[symbol] = Decimal(self.rng.randint(80, 900))
        created = self._when()
        self._emit_order(
            client_id=self.rng.choice(self.clients)[0], instrument_id=symbol, status="FILLED",
            created=created, terminal=created + timedelta(seconds=self.rng.uniform(1, 60)),
            executed=self._price_for(symbol), label="BAD unknown_instrument",
        )

    def bad_unknown_client(self):
        tag = uuid.uuid4().hex[:8]
        name = self.rng.choice(FIRST_NAMES) + " " + self.rng.choice(LAST_NAMES)
        account = "SIM" + tag.upper()
        client_id = int(self.cfg.scalar("SELECT nextval('clients_client_id_seq');"))
        # clients first: bank_account.client_id is a foreign key to it.
        self.statements.append(
            "INSERT INTO clients (client_id, name, created_on, account_state, wallet_balance) "
            "VALUES (" + str(client_id) + ", " + quote_literal(name)
            + ", now(), 'ACTIVE', 100000);"
        )
        self.statements.append(
            "INSERT INTO bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) "
            "VALUES (" + quote_literal(account) + ", " + str(client_id)
            + ", 250000, 'HDFC Bank', 'HDFC0000123');"
        )
        created = self._when()
        symbol = self.rng.choice(self.instruments)
        self._emit_order(
            client_id=client_id, instrument_id=symbol, status="FILLED",
            created=created, terminal=created + timedelta(seconds=self.rng.uniform(1, 60)),
            executed=self._price_for(symbol), label="BAD unknown_client",
        )

    # ------------------------------------------------------------ run

    def generate(self, count: int, bad_share: float, open_share: float):
        n_bad = max(1, round(count * bad_share)) if bad_share > 0 else 0
        n_open = round(count * open_share)
        n_terminal = max(0, count - n_bad - n_open)
        n_rejected = round(n_terminal * 0.2)
        n_cancelled = round(n_terminal * 0.12)
        n_filled = n_terminal - n_rejected - n_cancelled

        plan = (
            [self.filled] * n_filled + [self.rejected] * n_rejected
            + [self.cancelled] * n_cancelled + [self.open] * n_open
        )
        bad_cycle = [self.bad_late_creation, self.bad_unknown_instrument, self.bad_unknown_client]
        plan += [bad_cycle[i % 3] for i in range(n_bad)]
        self.rng.shuffle(plan)
        for make in plan:
            make()

    def script(self) -> str:
        return "\\set ON_ERROR_STOP on\nBEGIN;\n" + "\n".join(self.statements) + "\nCOMMIT;\n"


def build_parser():
    p = argparse.ArgumentParser(
        prog="simulate_orders",
        description="Write a batch of new, realistic orders (good, failed and bad) into the trade database.",
    )
    add_connection_args(p)
    p.add_argument("--count", type=int, default=20, help="orders to create (default 20)")
    p.add_argument("--bad-share", type=float, default=0.15,
                   help="fraction that the fact_trades load must dead-letter (default 0.15; 0 for none)")
    p.add_argument("--open-share", type=float, default=0.05,
                   help="fraction left NEW with no terminal event (default 0.05)")
    p.add_argument("--window-minutes", type=int, default=30,
                   help="spread created_at over the last N minutes, but never before the newest existing order")
    p.add_argument("--seed", type=int, help="seed the random generator for a repeatable mix (ids stay unique)")
    p.add_argument("--dry-run", action="store_true", help="print the SQL instead of running it")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.count < 1:
        say("error: --count must be at least 1")
        return 2

    # the secrets vault looks for its key file in the working directory
    os.chdir(REPO_ROOT)
    try:
        cfg = DbConfig.resolve(args)
    except DbError as exc:
        say("error: " + str(exc))
        return 1

    rng = random.Random(args.seed)
    sim = Simulation(cfg, rng, args.window_minutes)
    try:
        sim.load_reference()
        sim.generate(args.count, args.bad_share, args.open_share)
        if args.dry_run:
            say(sim.script())
            return 0
        cfg.run_or_die("writing simulated orders", script=sim.script(), verbose_errors=True)
    except DbError as exc:
        say("FAILED: " + str(exc))
        return 1

    say("Wrote " + str(len(sim.summary)) + " order(s) to " + cfg.describe()
        + " between " + sim.start.strftime("%H:%M:%S") + " and " + sim.end.strftime("%H:%M:%S"))
    say("")
    say("  %-24s %-36s %-12s %-4s %5s %12s" % ("kind", "order_id", "instrument", "side", "qty", "price"))
    for label, order_id, symbol, side, qty, price, _ in sorted(sim.summary):
        say("  %-24s %-36s %-12s %-4s %5d %12s" % (label, order_id, symbol, side, qty, price))

    counts = {}
    for label, *_ in sim.summary:
        counts[label] = counts.get(label, 0) + 1
    say("")
    say("  " + ", ".join(k + ": " + str(v) for k, v in sorted(counts.items())))
    say("")
    say("Next: python fact-trades/load_fact_trades.py facts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
