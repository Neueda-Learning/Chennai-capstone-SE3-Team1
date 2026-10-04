#!/usr/bin/env python3
"""Create (or reset) a ready-to-log-in test account by writing straight to the database.

Registering through the UI sends a one-time code by email. This skips all of that: it writes
the login, the trading account, a linked bank account and, unless told not to, some believable
activity (a funding transfer, two holdings, a few settled orders), so every screen has real
rows to show.

    python scripts/create_test_account.py                  # create, or reset the same account
    python scripts/create_test_account.py --no-sample-data # just the login, account and bank
    python scripts/create_test_account.py --seed-quotes    # also write a synthetic price history

Idempotent: running it again resets that account's activity and password and leaves everything
else alone. `clients` rows can never be deleted (a trigger forbids it), so an existing account is
reused rather than recreated.

Connection settings resolve exactly as in apply_db.py (the TrustMe vault, or flags).
The password is hashed with the auth service's own argon2 parameters by calling node from
Application/Services/auth-service, so the result signs in through the real /auth/login.

Test data only. Do not run against a database anyone depends on.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db_config import REPO_ROOT, DbConfig, DbError, _first_existing, add_connection_args, quote_literal  # noqa: E402

AUTH_DIR = _first_existing(
    REPO_ROOT / "Application" / "Services" / "auth-service",
    REPO_ROOT / "services" / "team1-nestjs",
)

# Same parameters as the auth service's password.constants.ts (Algorithm.Argon2id = 2).
HASH_JS = """
const { hash } = require('@node-rs/argon2');
hash(process.env.TEST_ACCOUNT_PASSWORD, { memoryCost: 65536, timeCost: 3, parallelism: 4, algorithm: 2 })
  .then((h) => process.stdout.write(h));
"""

# Plausible prices for the seeded instruments, only used by --seed-quotes.
SYNTHETIC_QUOTES = {
    "RELIANCE": (1300.10, 12.40),
    "TCS": (3300.50, -20.20),
    "INFY": (1450.00, 3.10),
    "HDFCBANK": (1650.25, 0.00),
    "ICICIBANK": (1120.00, 8.80),
    "ITC": (430.20, -1.10),
    "TATAMOTORS": (690.40, 4.30),
}


def hash_password(password: str) -> str:
    if not (AUTH_DIR / "node_modules" / "@node-rs" / "argon2").is_dir():
        raise DbError("Run `npm ci` in Application/Services/auth-service first: the password is hashed with its argon2 package.")
    proc = subprocess.run(
        ["node", "-e", HASH_JS],
        cwd=AUTH_DIR,
        env={**os.environ, "TEST_ACCOUNT_PASSWORD": password},
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not proc.stdout.startswith("$argon2id$"):
        raise DbError("could not hash the password with node: " + (proc.stderr or proc.stdout).strip())
    return proc.stdout.strip()


def sample_data_sql(username: str) -> str:
    """Activity for the account `cid`; coherent: 50,000 in, 12,500 + 17,000 spent on two buys."""
    key = quote_literal("testacct-" + username + "-")
    return f"""
    INSERT INTO wallet_transfers (client_id, account_number, direction, amount, idempotency_key, created_at)
    VALUES (cid, acct, 'BANK_TO_WALLET', 50000.00, {key} || 'fund-1', now() - interval '3 days');

    INSERT INTO portfolio_holding (client_id, instrument_id, quantity, price_per_unit, overall_gains)
    VALUES (cid, 'RELIANCE', 10, 1250.0000, 0), (cid, 'TCS', 5, 3400.0000, 0);

    -- Settled orders live in order_history (migration 010): two fills, a rejection, a cancellation.
    INSERT INTO order_history (order_id, event_type, previous_status, new_status, client_id, account_id, instrument_id,
                               order_type, side, quantity, price, executed_price, idempotency_key,
                               order_created_at, failure_code, event_timestamp, created_at)
    VALUES
      (gen_random_uuid(), 'FILLED',    'NEW', 'FILLED',    cid, cid, 'RELIANCE', 'HOLDING', 'BUY',  10, 1275.00, 1250.00, {key} || 'o1', now() - interval '2 days 2 minutes', NULL, now() - interval '2 days', now() - interval '2 days'),
      (gen_random_uuid(), 'FILLED',    'NEW', 'FILLED',    cid, cid, 'TCS',      'HOLDING', 'BUY',   5, 3450.00, 3400.00, {key} || 'o2', now() - interval '1 day 2 minutes',  NULL, now() - interval '1 day',  now() - interval '1 day'),
      (gen_random_uuid(), 'REJECTED',  'NEW', 'REJECTED',  cid, cid, 'ITC',      'HOLDING', 'BUY', 100,  400.00, NULL,    {key} || 'o3', now() - interval '5 hours 2 minutes', 'BUY_LIMIT_BELOW_ASK', now() - interval '5 hours', now() - interval '5 hours'),
      (gen_random_uuid(), 'CANCELLED', 'NEW', 'CANCELLED', cid, cid, 'INFY',     'HOLDING', 'BUY',   4, 1400.00, NULL,    {key} || 'o4', now() - interval '2 hours 2 minutes', NULL, now() - interval '2 hours', now() - interval '2 hours');
    """


def quotes_sql() -> str:
    rows = []
    for symbol, (price, change) in SYNTHETIC_QUOTES.items():
        previous = round(price - change, 2)
        pct = round(change / previous * 100, 4) if previous else 0
        rows.append(
            f"({quote_literal(symbol)}, {price}, {price - 0.2:.2f}, {price + 0.2:.2f}, 'INR', {change}, {pct}, {previous})"
        )
    return f"""
    -- A synthetic 3 hour history: one point a minute, wobbling around the headline price.
    -- Replaces whatever quotes were there, so re-running does not pile up duplicates.
    DELETE FROM market_quotes;
    INSERT INTO market_quotes (instrument_id, price, bid, ask, currency, day_change, change_percent,
                               previous_close, market_state, stale, quote_as_of, received_at)
    SELECT v.symbol,
           round((v.price + sin(g.n / 6.0) * v.price * 0.004)::numeric, 2),
           round((v.bid   + sin(g.n / 6.0) * v.price * 0.004)::numeric, 2),
           round((v.ask   + sin(g.n / 6.0) * v.price * 0.004)::numeric, 2),
           v.currency, v.change, v.pct, v.prev, 'REGULAR', FALSE,
           now() - (g.n || ' minutes')::interval, now() - (g.n || ' minutes')::interval
    FROM (VALUES {", ".join(rows)}) AS v(symbol, price, bid, ask, currency, change, pct, prev)
    CROSS JOIN generate_series(0, 179) AS g(n);

    -- Mark the holdings to the newest price, as the market-data listener would.
    UPDATE portfolio_holding h
       SET overall_gains = round((q.price - h.price_per_unit) * h.quantity, 2)
      FROM (SELECT DISTINCT ON (instrument_id) instrument_id, price
              FROM market_quotes ORDER BY instrument_id, received_at DESC, quote_id DESC) q
     WHERE q.instrument_id = h.instrument_id AND h.client_id = cid;
    """


def build_sql(args, password_hash: str) -> str:
    lit = quote_literal
    wallet = "20500.00" if not args.no_sample_data else "0.00"
    sample = "" if args.no_sample_data else sample_data_sql(args.username)
    quotes = quotes_sql() if args.seed_quotes else ""
    return f"""
DO $$
DECLARE
    cid  BIGINT;
    uid  UUID;
    acct VARCHAR(34) := {lit(args.account_number)};
BEGIN
    SELECT id, account_id INTO uid, cid FROM auth_db.users WHERE username = {lit(args.username)};

    IF cid IS NULL THEN
        INSERT INTO clients (name, account_state, wallet_balance)
        VALUES ({lit(args.holder_name)}, 'ACTIVE', {wallet}) RETURNING client_id INTO cid;
    ELSE
        -- Reuse the trading account (clients rows cannot be deleted) but wipe its activity.
        UPDATE clients SET name = {lit(args.holder_name)}, account_state = 'ACTIVE',
                           wallet_balance = {wallet}, version = version + 1, updated_on = now()
         WHERE client_id = cid;
        DELETE FROM order_history    WHERE client_id = cid;
        DELETE FROM orders           WHERE client_id = cid;
        DELETE FROM wallet_transfers WHERE client_id = cid;
        DELETE FROM portfolio_holding   WHERE client_id = cid;
        DELETE FROM portfolio_positions WHERE client_id = cid;
    END IF;

    INSERT INTO bank_account (account_number, client_id, account_balance, bank_name, ifsc_code)
    VALUES (acct, cid, {args.bank_balance}, {lit(args.bank_name)}, 'TEST0000001')
    ON CONFLICT (account_number) DO UPDATE
        SET client_id = EXCLUDED.client_id, account_balance = EXCLUDED.account_balance,
            bank_name = EXCLUDED.bank_name;

    IF uid IS NULL THEN
        INSERT INTO auth_db.users (username, email, phone, account_id, roles, password_hash,
                                   params_version, status, version, created_on, updated)
        VALUES ({lit(args.username)}, {lit(args.email)}, {lit(args.phone)}, cid, ARRAY['CUSTOMER'],
                {lit(password_hash)}, 1, 'ACTIVE', 1, now(), now());
    ELSE
        UPDATE auth_db.users
           SET email = {lit(args.email)}, phone = {lit(args.phone)}, account_id = cid,
               password_hash = {lit(password_hash)}, params_version = 1, status = 'ACTIVE',
               version = version + 1, updated = now()
         WHERE id = uid;
        DELETE FROM auth_db.refresh_tokens WHERE user_id = uid;
    END IF;
{sample}
{quotes}
END $$;
"""


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_connection_args(p)
    g = p.add_argument_group("the test account")
    g.add_argument("--username", default="test.trader")
    g.add_argument("--email", default="test.trader@example.test")
    g.add_argument("--phone", default="9000000001")
    g.add_argument("--login-password", default="TestTrader#2026!", help="the account's sign-in password (12+ chars)")
    g.add_argument("--holder-name", default="Test Trader")
    g.add_argument("--bank-name", default="Test Bank")
    g.add_argument("--account-number", default="IN45TEST0000000000001")
    g.add_argument("--bank-balance", default="450000.00")
    g.add_argument("--no-sample-data", action="store_true", help="skip the transfer, holdings and orders")
    g.add_argument("--seed-quotes", action="store_true", help="also write a synthetic 3 hour price history (needs migration 023)")
    args = p.parse_args(argv)

    if len(args.login_password) < 12:
        print("error: the auth service refuses passwords shorter than 12 characters", file=sys.stderr)
        return 2

    try:
        db = DbConfig.resolve(args)
        print("database:", db.describe())
        password_hash = hash_password(args.login_password)
        db.run_or_die("creating the test account", script=build_sql(args, password_hash))
    except DbError as error:
        print("error:", error, file=sys.stderr)
        return 1

    print()
    print("Test account ready (no email was sent):")
    print("  username :", args.username)
    print("  password :", args.login_password)
    print("  email    :", args.email)
    print("  holder   :", args.holder_name, "/", args.bank_name, args.account_number)
    print("  data     :", "login, account and bank only" if args.no_sample_data else "plus a funding transfer, 2 holdings and 4 settled orders")
    return 0


if __name__ == "__main__":
    sys.exit(main())
