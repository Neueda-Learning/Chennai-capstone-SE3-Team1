# Database Schema Explanation

## System Overview
Your trading platform has **8 core tables** + 1 audit/infrastructure table, organized into 3 layers:
1. **Authentication & User Management** (clients, auth, bank_account)
2. **Market Data** (instruments)
3. **Trading Core** (orders, order_history, portfolio_holding, portfolio_positions)

---

## Table Breakdown

### 1. **schema_migrations** (Infrastructure)
**Purpose:** Track which database migrations have been applied.

| Column | Type | Purpose |
|--------|------|---------|
| filename | VARCHAR(255) | Migration file name (e.g., `001_bank_account.sql`) |
| checksum | CHAR(64) | SHA256 hash of file to detect edits |
| applied_at | TIMESTAMP | When this migration was applied |

**Why it exists:** Ensures migrations run exactly once, no duplicates, no accidental re-runs.

---

### 2. **bank_account**
**Purpose:** Store external bank account details linked to each client.

| Column | Type | Purpose |
|--------|------|---------|
| account_number | VARCHAR(34) | Bank account identifier (IBAN-like) |
| client_id | BIGINT | FK to clients table |
| name | VARCHAR(150) | Account holder name |
| phone | VARCHAR(20) | Contact phone |
| email | VARCHAR(150) | Contact email |
| account_balance | DECIMAL(18,2) | Current bank balance (always >= 0) |
| bank_name | VARCHAR(150) | Which bank (e.g., "HDFC", "ICICI") |
| ifsc_code | VARCHAR(11) | Bank branch code for transfers |

**Why it exists:** Real-world trading requires linking to actual bank accounts for cash deposits/withdrawals.

**Relationship:** One bank_account per client (optional), one client can have multiple accounts (future feature).

---

### 3. **clients** (Core User Table)
**Purpose:** Main trading account/user entity.

| Column | Type | Purpose |
|--------|------|---------|
| client_id | BIGSERIAL | Auto-increment primary key |
| account_number | VARCHAR(34) | FK to bank_account (optional) |
| name | VARCHAR(150) | Client name |
| email | VARCHAR(150) | Unique, used for login |
| phone | VARCHAR(20) | Contact |
| created_on | TIMESTAMP | Account open date |
| account_state | VARCHAR(10) | ACTIVE / SUSPENDED / CLOSED |
| wallet_balance | DECIMAL(18,2) | Trading account cash (always >= 0) |
| version | INT | Optimistic lock counter (for concurrent updates) |
| updated_on | TIMESTAMP | Last modified time |

**State Machine (enforced by triggers):**
- `ACTIVE` → `SUSPENDED` or `CLOSED`
- `SUSPENDED` → `ACTIVE` or `CLOSED`
- `CLOSED` is **terminal** (cannot reopen)
- Cannot be deleted; must be closed instead (soft delete pattern)

**Why wallet_balance exists:** When you BUY, cash is deducted. When you SELL, cash is credited. This is your trading buying power.

---

### 4. **auth**
**Purpose:** Authentication credentials for clients.

| Column | Type | Purpose |
|--------|------|---------|
| email | VARCHAR(150) | PK, FK to clients.email (unique login) |
| password_hash | VARCHAR(255) | Bcrypt/argon2 hashed password |
| created | TIMESTAMP | Password creation time |
| updated | TIMESTAMP | Last password change |
| version | INT | Optimistic lock for password updates |

**Why separate table:** 
- Isolates sensitive data
- Can clear/reset password without touching client profile
- Audit trail of password changes

---

### 5. **instruments**
**Purpose:** Master list of tradable securities (stocks, ETFs, etc.).

| Column | Type | Purpose |
|--------|------|---------|
| instrument_id | VARCHAR(20) | PK (e.g., "INFY", "TCS", "NIFTY50") |
| instrument_name | VARCHAR(150) | Full name (e.g., "Infosys Ltd") |
| active | BOOLEAN | FALSE = delisted/suspended, TRUE = tradable |
| updated_on | TIMESTAMP | Last price update from market |

**Why soft delete:** 
- Orders reference instruments by FK
- Cannot physically delete without orphaning order history
- Setting `active=FALSE` hides from trading UI but keeps history intact

**Use case in executor:**
```
OrderConsumer checks: if (instrument.active == FALSE) → REJECT order
```

---

### 6. **orders** (Most Critical Table)
**Purpose:** Records every trade request placed by clients.

| Column | Type | Purpose |
|--------|------|---------|
| order_id | UUID | Unique order identifier (used by Kafka as message key) |
| client_id | BIGINT | Who placed this order |
| account_id | BIGINT | Which account (for multi-account support) |
| instrument_id | VARCHAR(20) | What to trade (INFY, TCS, etc.) |
| order_type | VARCHAR(8) | POSITION or HOLDING |
| side | VARCHAR(4) | BUY or SELL |
| quantity | DECIMAL(18,4) | How many shares |
| price | DECIMAL(18,4) | Limit price (max for BUY, min for SELL) |
| executed_price | DECIMAL(18,4) | Actual fill price (NULL until FILLED) |
| status | VARCHAR(10) | NEW → FILLED/REJECTED/CANCELLED |
| idempotency_key | VARCHAR(100) | Unique per client (deduplication) |
| external_order_id | VARCHAR(100) | Exchange order ID (if filled) |
| created_at | TIMESTAMP | When order was placed |
| updated_at | TIMESTAMP | Last status change |
| executed_on | TIMESTAMP | When order was filled (added in migration 010) |

**Status Flow:**
```
NEW → FILLED (price matched) / REJECTED (price no match or error)
NEW → CANCELLED (client cancel)
```

**Constraints:**
- Quantity > 0 (must buy/sell at least 1 share)
- Price > 0
- If status=FILLED, executed_price must NOT be null
- If status!=FILLED, executed_price must be null

**Where it's used:**
1. API creates NEW order, publishes to Kafka `orders` topic
2. Executor consumes, fetches quote, decides FILL/REJECT
3. Executor updates status + executed_price
4. Settlement service debits/credits wallet and positions

---

### 7. **order_history**
**Purpose:** Audit trail of every order state change.

| Column | Type | Purpose |
|--------|------|---------|
| history_id | BIGSERIAL | Auto-increment log entry ID |
| order_id | UUID | Which order (FK) |
| event_type | VARCHAR(50) | "ORDER_PLACED", "EXECUTION_ATTEMPT", "FILLED", "REJECTED", etc. |
| previous_status | VARCHAR(10) | Order status before this event |
| new_status | VARCHAR(10) | Order status after this event |
| external_status | VARCHAR(50) | Exchange response status |
| external_order_id | VARCHAR(100) | Exchange confirmation ID |
| request_id | VARCHAR(100) | Request ID for tracing |
| failure_code | VARCHAR(50) | Error code if failed |
| failure_reason | VARCHAR(255) | Human-readable error |
| api_response | TEXT | Full API response (for debugging) |
| event_timestamp | TIMESTAMP | When event occurred |
| created_at | TIMESTAMP | When log entry created |

**Why it exists:** 
- Regulatory compliance (must keep trade audit trail)
- Debugging (see exactly what happened to an order)
- Analytics (track fill rates, rejection reasons, etc.)

**Constraint:** Ensures previous_status ≠ new_status (don't log "no-op" state changes)

---

### 8. **portfolio_holding**
**Purpose:** Long-term positions you own (cash account holdings).

| Column | Type | Purpose |
|--------|------|---------|
| holding_id | BIGSERIAL | Auto-increment ID |
| client_id | BIGINT | Which client owns this |
| instrument_id | VARCHAR(20) | What they own (INFY, TCS, etc.) |
| quantity | INT | Number of shares held |
| price_per_unit | DECIMAL(18,4) | Cost basis (what they paid per share) |
| overall_gains | DECIMAL(18,2) | Unrealized profit/loss |
| created_at | TIMESTAMP | When position created |
| updated_at | TIMESTAMP | Last update |

**Unique constraint:** One holding per (client_id, instrument_id) pair.

**When it's updated:**
- BUY order FILLED → quantity increases, price_per_unit recalculated
- SELL order FILLED → quantity decreases

**Formula for gains:**
```
overall_gains = (current_market_price - price_per_unit) * quantity
```

**Use case:**
```
executor/settlement: 
  if (order.side == BUY) portfolio_holding.quantity += order.quantity
  if (order.side == SELL) portfolio_holding.quantity -= order.quantity
```

---

### 9. **portfolio_positions**
**Purpose:** Margin/short positions (for advanced trading, currently separate tracking).

| Column | Type | Purpose |
|--------|------|---------|
| position_id | BIGSERIAL | Auto-increment ID |
| client_id | BIGINT | Who holds this position |
| instrument_id | VARCHAR(20) | What instrument |
| quantity | INT | Shares in position (can be negative for shorts) |
| price_per_unit | DECIMAL(18,4) | Entry price |
| overall_gains | DECIMAL(18,2) | Current unrealized P&L |
| created_at | TIMESTAMP | When position opened |
| updated_at | TIMESTAMP | Last update |

**Difference from portfolio_holding:**
- **holding** = you own the shares outright
- **positions** = margin/leveraged positions (can be shorted)

**Current state in your project:** 
- Both tables exist but may be used interchangeably (order_type can be "POSITION" or "HOLDING")
- Future: separate buy-and-hold from margin trading

---

## Data Flow Example: Placing a BUY Order for 10 shares of INFY at price 500

```
1. Client submits order via API
   ↓
2. API validates & creates row in orders table
   status = NEW, executed_price = NULL
   ↓
3. API publishes ORDER_PLACED event to Kafka orders topic
   ↓
4. [Async] Executor consumes order from Kafka
   ↓
5. Executor queries:
   - instruments table: INFY exists? active=TRUE?
   - clients table: client_id=1 exists? account_state=ACTIVE?
   ↓
6. Executor fetches quote from Fauxnance API
   Example: ask=510, bid=495
   ↓
7. FillRule evaluates:
   - BUY side: is (limit_price >= ask)?
   - 500 >= 510? NO → REJECT
   ↓
8. Executor updates orders table:
   UPDATE orders SET status='REJECTED', updated_at=now()
   ↓
9. Executor inserts audit log in order_history table:
   event_type='REJECTED', previous_status='NEW', new_status='REJECTED',
   failure_reason='BUY_LIMIT_BELOW_ASK'
   ↓
10. Executor publishes ORDER_REJECTED to trade-events Kafka topic
    ↓
11. wallet_balance in clients table unchanged (no debit)
```

**If order had filled (priced at 500):**
```
7. FillRule: 500 >= 510? YES → FILL at ask=510
8. Executor updates: status='FILLED', executed_price=510
9. Settlement deducts from clients.wallet_balance: -5100 (10 × 510)
10. Settlement increases portfolio_holding: quantity += 10
11. order_history records status change NEW→FILLED
```

---

## Key Relationships

```
clients (1) ──→ (N) orders
clients (1) ──→ (N) portfolio_holding
clients (1) ──→ (N) portfolio_positions
clients (1) ──→ (1) auth
clients (1) ──→ (0/1) bank_account

instruments (1) ──→ (N) orders
instruments (1) ──→ (N) portfolio_holding
instruments (1) ──→ (N) portfolio_positions

orders (1) ──→ (N) order_history
```

---

## Indexes (Performance Optimization)

| Table | Index | Purpose |
|-------|-------|---------|
| bank_account | client_id | Quick lookup by client |
| clients | account_number, account_state | Filter by state or bank link |
| instruments | active | List only tradable instruments |
| orders | client_id, account_id, instrument_id, status, order_type | Fast queries by each dimension |
| order_history | (order_id, event_timestamp) | Chronological audit trail |
| portfolio_holding | client_id, instrument_id | Quick lookup: "what does client own?" |
| portfolio_positions | client_id, instrument_id | Quick lookup for margin positions |

---

## Constraints (Data Integrity)

**Foreign Keys:**
- orders.client_id → clients.client_id
- orders.instrument_id → instruments.instrument_id
- portfolio_holding.client_id → clients.client_id
- portfolio_holding.instrument_id → instruments.instrument_id
- (similar for portfolio_positions)

**Checks (domain rules):**
- wallet_balance >= 0
- quantity > 0
- price > 0
- status ∈ {NEW, FILLED, REJECTED, CANCELLED}
- If FILLED, executed_price must be set

**Triggers (business logic in DB):**
- Cannot delete clients (must close instead)
- Cannot delete instruments (must deactivate)
- Cannot reopen a CLOSED account
- Cannot modify CLOSED account state

---

## Summary

| Table | Type | Role |
|-------|------|------|
| schema_migrations | Infrastructure | Track schema versions |
| clients | Core | User accounts |
| auth | Core | Login credentials |
| bank_account | Core | External bank links |
| instruments | Market | Tradable securities |
| orders | Trading | Individual trade requests |
| order_history | Audit | Trade event log |
| portfolio_holding | Position | Long-term holdings |
| portfolio_positions | Position | Margin/leveraged positions |

**Current active flow:** clients → orders → order_history → (portfolio_holding or portfolio_positions based on order_type)


