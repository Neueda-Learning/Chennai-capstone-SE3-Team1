# 5-PERSON VIVA PRESENTATION SPLIT
## Chennai Capstone Trading Platform - Complete Division of Responsibility

---

## EXECUTIVE SUMMARY

| Person | Focus Area | Duration | Key Responsibility |
|--------|-----------|----------|-------------------|
| **1** | **Class Diagram + Database** | 15 min | Domain entities, UML, schema design, relationships, constraints |
| **2** | **Security + TrustMe** | 12 min | JWT auth flow, token validation, authorization guards, secrets vault |
| **3** | **Core Trading Features** | 20 min | Order placement, execution, accounts, wallet, Executor service integration |
| **4** | **Extension Modules (Customer Features)** | 20 min | Watchlists, alerts, notifications, preferences, portfolio P&L, chat |
| **5** | **Testing & Verification** | 10 min | Unit/integration/E2E tests, schema parity, test running, coverage |

**Total: 90 minutes (77 mins presentation + 13 mins Q&A)**

---

## PERSON 1: CLASS DIAGRAM + DATABASE DESIGN (15 mins)

### Exact Entities to Study
Read these files for complete understanding:

**Domain Entities** (Framework-free domain model):
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/Client.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/Order.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/OrderHistory.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/Instrument.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/BankAccount.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/PortfolioPosition.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/PortfolioHolding.java
- Application/Services/libs/domain-engine/src/main/java/com/team1/trading/domain/entity/PortfolioEntry.java

### Presentation Outline
1. **Overview** (2 min) - 4 services architecture, 2 databases (PostgreSQL + DuckDB)
2. **Domain Model** (4 min) - 8 core entities, relationships, cardinality
3. **UML Class Diagram** (3 min) - Draw relationships (1:N, N:N)
4. **Database Schema** (4 min) - Tables, columns, constraints, indexes
5. **Data Lifecycle** (2 min) - Order from NEW → FILLED → SETTLED

### Key Database Tables
\\
clients (PK: id, UK: email)
  ├─ orders (FK: client_id, UK: (client_id, idempotency_key))
  │   └─ order_history (audit trail)
  ├─ bank_accounts (FK: client_id)
  ├─ wallet_transfers
  ├─ portfolio_positions (FK: client_id, symbol)
  ├─ portfolio_holdings (FK: client_id)
  ├─ watchlists (FK: client_id)
  │   ├─ watchlist_instruments
  │   └─ price_alerts (state: ARMED/FIRED)
  ├─ customer_preferences (channel: EMAIL/SMS/PUSH)
  └─ notification_ledger (delivery_state)

instruments (PK: symbol)
  ├─ market_quotes
  └─ daily_candles
\\

### Critical Constraints
- **Idempotency**: UNIQUE(client_id, idempotency_key) on orders table
- **Status Progression**: orders.status ∈ {NEW, FILLED, REJECTED, CANCELLED}
- **Alert States**: price_alerts.state ∈ {ARMED, FIRED}
- **Foreign Keys**: Enforce referential integrity (client_id, symbol, etc.)

### Key Design Patterns
1. **Idempotent Order Placement**: Same order with same key → only one row
2. **Immutable Audit Trail**: order_history never deleted (append-only)
3. **Average Cost Calculation**: (old_qty*old_cost + new_qty*new_price) / total_qty
4. **Schema Versioning**: 30 migrations (000_migration_ledger.sql → 024_daily_candles.sql)

### Viva Questions Person 1 Should Answer
1. "Draw the UML diagram showing Order, Client, PortfolioPosition relationships."
2. "What is the UNIQUE constraint on orders table and why?"
3. "How does the system prevent duplicate orders?"
4. "Walk me through the order_history audit trail design."
5. "How are portfolio positions tracked across multiple orders?"
6. "What does schema parity mean and how is it verified?"
7. "Explain the migration strategy (immutability, checksums)."
8. "What is the difference between orders and order_history tables?"
9. "How are average costs calculated in portfolio_positions?"
10. "What entities represent a customer's cash and holdings?"

---

## PERSON 2: SECURITY + TRUSTME MODULE (12 mins)

### Exact Security Files to Study

**Authentication (NestJS/Node)**:
- Application/Services/auth-service/src/auth/auth.controller.ts
- Application/Services/auth-service/src/auth/auth.service.ts
- Application/Services/auth-service/src/auth/jwt.strategy.ts
- Application/Services/auth-service/src/config/configuration.ts
- Application/Services/auth-service/AUTH_IMPLEMENTATION.md (if exists)

**JWT Verification (Spring Boot/Java)**:
- Application/Services/order-service/src/main/java/com/team1/trading/api/security/JwtValidator.java
- Application/Services/order-service/src/main/java/com/team1/trading/api/security/JwtVerificationFilter.java
- Application/Services/order-service/src/main/java/com/team1/trading/api/security/HeaderTokenAccountIdResolver.java

**Configuration**:
- Application/Services/order-service/src/main/resources/application.yml (JWT_SECRET, expires)

**Tests**:
- Application/Services/order-service/src/test/java/com/team1/trading/api/security/JwtValidatorTest.java
- Application/Services/order-service/src/test/java/com/team1/trading/api/security/JwtVerificationFilterTest.java
- Application/Services/order-service/src/test/java/com/team1/trading/api/security/HeaderTokenAccountIdResolverTest.java
- Application/Services/order-service/src/test/java/com/team1/trading/api/security/ModuleRouteAuthorisationTest.java

### Presentation Outline
1. **Authentication Flow** (3 min)
   - Login: POST /auth/login {username, password_encrypted} → JWT token
   - JWT structure: header.payload.signature
   - Claims: sub (user ID), accountId, roles, iat, exp

2. **Token Verification** (3 min)
   - Every request to /api/v1/* includes Authorization: Bearer <token>
   - JwtVerificationFilter intercepts, validates signature
   - HeaderTokenAccountIdResolver extracts accountId from claims
   - Token expiry checked (no expired tokens accepted)

3. **Authorization & Access Control** (2 min)
   - Guards check ownership: "Does user A own account A?"
   - Example: @GuardedRoute("account", "id") ensures user can only access their account
   - Route-level authorization: /api/v1/preferences requires JWT

4. **TrustMe Vault** (2 min)
   - Centralized secrets management (not in git, not hardcoded)
   - Secrets: JWT_SECRET, POSTGRES_PASSWORD, Fauxnance_ApiKey, SMTP_*, LLM_API_KEY, AUTH_PRIVATE_KEY
   - Loaded at application startup via environment configuration
   - Reference: README.md (Configuration section), leapcapstoneteam1-720d03.TM (actual vault)

5. **Password Handling** (1 min)
   - RSA encryption: Frontend encrypts password before sending
   - Hashing: Auth service hashes with Argon2id (never stored plain-text)
   - Verification: On login, compare hash of input with stored hash

6. **Security Patterns** (1 min)
   - No hardcoded credentials (all from vault)
   - Token expiry: Default 1 hour (configurable)
   - Ownership checks on all resource access
   - Input validation (XSS, SQL injection prevention)

### JWT Token Example
\\json
{
  "sub": "user123",
  "accountId": "account456",
  "email": "user@example.com",
  "roles": ["USER"],
  "iat": 1700000000,
  "exp": 1700003600,
  "iss": "team1-trading"
}
\\

### TrustMe Vault Structure
\\
leapcapstoneteam1-720d03.TM
├─ PostGres_User
├─ PostGres_Password
├─ PostGres_Host
├─ JWT_SECRET
├─ Fauxnance_ApiKey
├─ SMTP_Host
├─ SMTP_Port
├─ SMTP_User
├─ SMTP_Password
├─ AUTH_PRIVATE_KEY (RSA)
└─ LLM_API_KEY
\\

### Viva Questions Person 2 Should Answer
1. "Walk me through the authentication flow from login to JWT token."
2. "What does a JWT token contain and how is it structured?"
3. "How is the JWT token validated on every request?"
4. "What happens if a JWT token expires?"
5. "How are passwords encrypted and hashed?"
6. "What is the TrustMe vault and which secrets does it contain?"
7. "How does the ownership guard prevent users from accessing each other's data?"
8. "What is RSA encryption and where is it used?"
9. "Show me the JwtVerificationFilter and explain how it works."
10. "How does the system prevent unauthorized access to /api/v1/preferences?"

---

## PERSON 3: CORE TRADING FEATURES (20 mins)

### Major Features Assigned
1. **Order Placement** (7 min)
2. **Order Execution** (6 min)
3. **Account Management** (4 min)
4. **Wallet Transfers** (3 min)

### FEATURE 1: ORDER PLACEMENT (7 mins)

**Frontend**:
- Component: Application/Frontend/frontend-app/src/app/features/orders/order-ticket-page.ts
- Form: symbol, quantity, side (BUY/SELL), limitPrice, orderType (LIMIT/MARKET)
- HTTP: POST /api/v1/orders

**Backend Controller**:
- File: Application/Services/order-service/src/main/java/com/team1/trading/api/controller/OrderController.java
- Endpoint: POST /api/v1/orders
- Input DTO: CreateOrderRequest {accountId, symbol, quantity, side, limitPrice, orderType, idempotencyKey}
- Output DTO: OrderResponse {orderId, status, symbol, quantity, limitPrice, createdAt}

**Service Layer**:
- File: Application/Services/order-service/src/main/java/com/team1/trading/api/service/OrderService.java
- Method: placeOrder(CreateOrderRequest req) throws OrderValidationException
- Steps:
  1. Validate account exists
  2. Validate instrument exists and tradable
  3. Validate balance sufficient (balance ≥ quantity * limitPrice)
  4. Create Order entity with status = NEW
  5. Insert via OrderMapper.insert()
  6. Publish ORDER_PLACED event to Kafka orders topic

**Repository (MyBatis)**:
- File: Application/Services/order-service/src/main/java/com/team1/trading/api/repository/OrderMapper.java
- SQL: INSERT INTO orders (client_id, symbol, quantity, side, limit_price, status, idempotency_key, created_at, ...)
- UNIQUE constraint: UNIQUE(client_id, idempotency_key) prevents duplicate submissions

**Database**:
- Table: orders
  \\sql
  CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    client_id BIGINT NOT NULL REFERENCES clients(id),
    symbol VARCHAR(10) NOT NULL REFERENCES instruments(symbol),
    quantity INT NOT NULL,
    side VARCHAR(10) NOT NULL, -- BUY or SELL
    limit_price DECIMAL(10,2),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    idempotency_key UUID NOT NULL,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP,
    UNIQUE(client_id, idempotency_key)
  );
  \\

**Kafka Publishing**:
- Topic: orders (partition key: accountId)
- Event: OrderPlaced {orderId, accountId, symbol, quantity, side, limitPrice, orderType}
- File: Application/Services/order-service/src/main/java/com/team1/trading/api/event/KafkaOrderEventPublisher.java

**Test**:
- File: Application/Services/order-service/src/test/java/com/team1/trading/api/characterisation/OrderPlacementCharacterisationTest.java
- Tests:
  - Valid order placement
  - Invalid account (404)
  - Insufficient balance (400)
  - Duplicate idempotency key (409 Conflict or 200 Idempotent)

---

### FEATURE 2: ORDER EXECUTION (6 mins)

**Executor Service** (separate Java service):
- File: Application/Services/executor-service/src/main/java/com/team1/trading/executor/OrderConsumer.java
- Consumes from: orders topic (consumer group: trade-executor)

**Execution Steps**:
1. Receive ORDER_PLACED event from Kafka
2. Fetch order from PostgreSQL
3. Call Fauxnance API: GET /quotes/{symbol}
4. Evaluate fill rule (FillService.java)
5. Update order.status to FILLED or REJECTED
6. Publish ORDER_FILLED or ORDER_REJECTED to 	rade-events topic

**Fill Rules** (FillService.java):
\\
BUY order at limit_price:
  - Execute if fauxnance_quote.ask ≤ limit_price
  - execution_price = quote.ask

SELL order at limit_price:
  - Execute if fauxnance_quote.bid ≥ limit_price
  - execution_price = quote.bid

MARKET order:
  - Execute immediately at quote.last
\\

**Database Updates**:
- Update: UPDATE orders SET status = 'FILLED', execution_price = ?, filled_at = ? WHERE id = ? AND status = 'NEW'
  - Guarded update: if 0 rows affected, order already handled (idempotent)
- Insert: INSERT INTO order_history (order_id, status, execution_price, filled_quantity, created_at) VALUES (...)
  - Audit trail of every status change

**Kafka Publishing**:
- Topic: 	rade-events (partition key: accountId)
- Event: OrderFilled {orderId, accountId, symbol, quantity, executionPrice, filledAt, settlementDate}
- Consumed by:
  - Portfolio service (updates positions)
  - Notifications service (sends alert)
  - Analytics loader (loads to DuckDB)

**External Integration**:
- Fauxnance API: GET /api/quotes/{symbol} → {bid, ask, last, timestamp}
- File: Application/Services/executor-service/src/main/java/com/team1/trading/executor/FauxnanceClient.java

---

### FEATURE 3: ACCOUNT MANAGEMENT (4 mins)

**Endpoints**:
- GET /api/v1/accounts/{accountId} → AccountResponse
- GET /api/v1/accounts/{accountId}/balance → BalanceResponse
- GET /api/v1/accounts/{accountId}/orders → List<OrderResponse>

**Backend**:
- Controller: Application/Services/order-service/src/main/java/com/team1/trading/api/controller/AccountController.java
- Service: Application/Services/order-service/src/main/java/com/team1/trading/api/service/AccountService.java
- Repository: AccountMapper.xml (MyBatis)

**Account Response Structure**:
\\json
{
  "accountId": "account123",
  "clientId": "client456",
  "email": "user@example.com",
  "kycStatus": "VERIFIED",
  "createdAt": "2024-01-01T00:00:00Z"
}
\\

**Balance Response Structure**:
\\json
{
  "cashBalance": 50000.00,
  "wallet": 25000.00,
  "holdingsValue": 150000.00,
  "totalValue": 225000.00
}
\\

---

### FEATURE 4: WALLET TRANSFERS (3 mins)

**Endpoint**:
- POST /api/v1/wallet/transfer
- Request: {accountId, amount, direction} (direction: DEPOSIT or WITHDRAW)
- Response: {transferId, status, amount, timestamp}

**Backend**:
- Controller: Application/Services/order-service/src/main/java/com/team1/trading/api/controller/WalletTransferController.java
- Service: Application/Services/order-service/src/main/java/com/team1/trading/api/service/WalletService.java

**Database**:
- Table: wallet_transfers
  \\sql
  CREATE TABLE wallet_transfers (
    id BIGINT PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES clients(id),
    amount DECIMAL(10,2) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- DEPOSIT or WITHDRAW
    status VARCHAR(20) NOT NULL, -- PENDING, COMPLETED, FAILED
    created_at TIMESTAMP NOT NULL
  );
  \\

---

### Test References for Person 3
1. OrderPlacementCharacterisationTest.java (comprehensive order flow)
2. TradeApiControllerWebTest.java (HTTP API tests)
3. AccountReadIntegrationTest.java (account retrieval)
4. WalletTransferControllerWebTest.java (wallet operations)

### Viva Questions Person 3 Should Answer
1. "Walk me through order placement from UI form submission to database insertion."
2. "What is the idempotency key and why is it important?"
3. "How does the executor service know when an order is ready to fill?"
4. "Explain the fill rule logic for BUY vs. SELL orders."
5. "What is a guarded UPDATE and why is it used for order execution?"
6. "Show me the ORDER_PLACED event structure and which Kafka topic it goes to."
7. "How is the order_history audit trail used?"
8. "What validation is performed on order placement?"
9. "How does wallet balance ensure sufficient funds for order?"
10. "If the same order is submitted twice, what happens (idempotency)?"

---

## PERSON 4: CUSTOMER FEATURES - EXTENSION MODULES (20 mins)

### Major Features Assigned
1. **Watchlists & Price Alerts** (6 min)
2. **Notifications & Delivery** (4 min)
3. **Preferences** (3 min)
4. **Portfolio & P&L** (4 min)
5. **Chat Assistant** (3 min)

### FEATURE 1: WATCHLISTS & PRICE ALERTS (6 mins)

**What User Does**: Create watchlist → Add instruments → Set price threshold alerts

**Frontend**:
- Components: Application/Frontend/frontend-app/src/app/features/watchlists/
- Forms: Create watchlist, add symbol, set alert (threshold + direction)

**Backend Module** (Extension module in Order Service):
- Package: com.team1.trading.api.watchlists
- Controllers:
  - WatchlistController.java (POST /watchlists, POST /watchlists/{id}/instruments)
  - AlertController.java (POST /alerts, PATCH /alerts/{id}, GET /alerts)

**Database**:
- Tables:
  \\sql
  watchlists (id, customer_id, name, created_at)
  watchlist_instruments (watchlist_id, symbol)
  price_alerts (id, symbol, threshold, direction, state, fired_at, watchlist_id)
    -- state: ARMED (listening) or FIRED (crossed, waiting re-arm)
    -- direction: ABOVE or BELOW
  \\

**Alert Lifecycle**:
1. User POSTs /api/v1/alerts {symbol, threshold, direction}
   - state = ARMED (default)
2. Executor polls quotes every 5s → publishes QUOTE to market-data topic
3. MarketDataAlertListener consumes QUOTE
   - Calls AlertEvaluator.evaluate(symbol, price)
   - Checks: does price CROSS threshold for ARMED alerts?
4. If crossed:
   - Guarded UPDATE: UPDATE price_alerts SET state = 'FIRED' WHERE id = ? AND state = 'ARMED'
   - Calls NotificationDelivery.deliver(AlertNotification) (Java interface)
5. If delivery fails:
   - AlertDeliverySweeper (runs every 60s) retries
6. User re-arms:
   - PATCH /api/v1/alerts/{id} {state: "ARMED"}
   - Clears fired_at, state = ARMED

**Services**:
- File: Application/Services/order-service/src/main/java/com/team1/trading/api/watchlists/
  - AlertService.java (create, update, delete)
  - AlertEvaluator.java (evaluate threshold crossing)
  - MarketDataAlertListener.java (@KafkaListener, consumes market-data)
  - AlertDeliverySweeper.java (@Scheduled, retries failed deliveries)

**Key Design Pattern**: 
- Guarded update prevents double-fire: WHERE state = 'ARMED' ensures only ARMED alerts can fire
- If two handlers try to fire same alert, only one succeeds (1 row affected)

**Test**:
- AlertEvaluationFlowTest.java (complete flow: alert creation → quote → fire → notification)
- WatchlistFlowTest.java (end-to-end watchlist + alert workflow)

---

### FEATURE 2: NOTIFICATIONS & DELIVERY (4 mins)

**What Happens**: When alert fires (or trade completes), customer receives notification

**Backend Module** (Extension module in Order Service):
- Package: com.team1.trading.api.notifications
- Controllers:
  - NotificationHistoryController.java (GET /notifications/history, GET /notifications/ledger)

**Services**:
- NotificationDeliveryService.java (main delivery logic)
- NotificationDispatcher.java (routes to channel)
- MessageComposer.java (builds message text)
- TradeEventListener.java (@KafkaListener, consumes trade-events)
- OutboundChannels.java (EMAIL via SMTP, SMS via stub, PUSH via Firebase)

**Delivery Flow**:
1. Alert fires (or ORDER_FILLED published)
2. NotificationDeliveryService receives AlertNotification
3. Resolve customer channel via Preferences module
4. Route to OutboundChannels:
   - EMAIL: SMTP send (from vault: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD)
   - SMS: Stub (simulated, not actually sent)
   - PUSH: Firebase Cloud Messaging
5. Record in notification_ledger table with delivery_state

**Database**:
- Table: 
otification_ledger
  \\sql
  CREATE TABLE notification_ledger (
    id BIGINT PRIMARY KEY,
    account_id BIGINT NOT NULL,
    alert_id BIGINT,
    message TEXT NOT NULL,
    channel VARCHAR(20), -- EMAIL, SMS, PUSH
    delivery_state VARCHAR(20), -- QUEUED, PENDING_CHANNEL, DELIVERY_SENT, DELIVERY_FAILED, REJECTED
    delivery_attempt_count INT DEFAULT 0,
    last_attempt_time TIMESTAMP,
    created_at TIMESTAMP NOT NULL
  );
  \\

**Delivery States**:
- **QUEUED**: Alert fired, waiting to send
- **PENDING_CHANNEL**: No channel preference stored, cannot send (ADR 0004)
- **DELIVERY_SENT**: Successfully sent (email/SMS/PUSH)
- **DELIVERY_FAILED**: Send attempt failed (SMTP error, Firebase error, etc.)
- **REJECTED**: Customer unsubscribed

**Retry Logic** (AlertDeliverySweeper):
- Runs every 60 seconds (scheduled task)
- Queries: SELECT * FROM notification_ledger WHERE delivery_state = 'DELIVERY_FAILED' AND last_attempt_time < NOW() - 60s
- Retries delivery (up to max attempts, e.g., 5)
- Updates last_attempt_time, delivery_attempt_count
- If max retries exceeded: mark as permanent failure

**Test**:
- NotificationDeliveryServiceTest.java (routing logic)
- NotificationLedgerFlowTest.java (delivery state tracking)
- OutboundChannelsTest.java (channel-specific delivery)

---

### FEATURE 3: PREFERENCES (3 mins)

**What User Does**: Set preferred notification channel (EMAIL, SMS, or PUSH)

**Backend Module** (Extension module):
- Package: com.team1.trading.api.preferences
- Controller: PreferenceController.java
  - GET /api/v1/preferences/{accountId} → {channel: "EMAIL"}
  - PATCH /api/v1/preferences/{accountId} → {channel: "PUSH"}

**Service**:
- PreferenceService.java (store preference)
- PreferenceResolver.java (resolve contact details at send time)
- DatabasePreferenceResolver.java (implementation, queries auth_db.users)

**Key Design** (ADR 0003):
- Preferences table stores ONLY the channel choice
- Contact details (email, phone) are NOT stored in preferences
- At send time, PreferenceResolver queries auth_db.users for actual email/phone
- Never caches contact details → always resolves fresh
- If channel = EMAIL and email is NULL in auth_db.users → notification_ledger state = PENDING_CHANNEL

**Database**:
- Table: customer_preferences
  \\sql
  CREATE TABLE customer_preferences (
    id BIGINT PRIMARY KEY,
    account_id BIGINT NOT NULL UNIQUE,
    channel VARCHAR(20), -- EMAIL, SMS, PUSH, or NULL (no preference)
    updated_at TIMESTAMP NOT NULL
  );
  \\
  - Note: NO email_address or phone_number columns here

**Workflow**:
1. User PATCH /api/v1/preferences/123 {channel: "EMAIL"}
2. PreferenceService updates customer_preferences.channel = "EMAIL"
3. At notification time:
   - PreferenceResolver.resolve(accountId) queries auth_db.users.email
   - If email exists: compose message with email address
   - If email is NULL: mark notification as PENDING_CHANNEL (cannot send)

**Test**:
- PreferenceControllerWebTest.java (API endpoints)
- DatabasePreferenceResolverTest.java (resolution logic)
- PreferenceServiceTest.java (preference update)

---

### FEATURE 4: PORTFOLIO & P&L (4 mins)

**What User Sees**: Holdings, average cost, unrealized P&L, realized P&L, total value

**Frontend**:
- Component: Application/Frontend/frontend-app/src/app/features/dashboard/
- Displays: positions table, P&L chart, portfolio summary

**Backend Endpoint**:
- GET /api/v1/accounts/{id}/portfolio
- Response:
  \\json
  {
    "positions": [
      {
        "symbol": "AAPL",
        "quantity": 10,
        "avgCost": 151.67,
        "currentPrice": 160.00,
        "unrealizedPNL": 83.30,
        "totalValue": 1600.00
      }
    ],
    "totalValue": 50000.00,
    "totalUnrealizedPNL": 1500.00,
    "totalRealizedPNL": 2000.00
  }
  \\

**Backend Module** (Extension module):
- Package: com.team1.trading.api.portfolio
- Controllers:
  - PortfolioController.java (GET portfolio endpoints)
- Services:
  - PortfolioService.java (fetch positions, calculate P&L)
  - MarketDataListener.java (@KafkaListener, updates positions on new quotes)

**How Positions Update**:
1. Order fills (ORDER_FILLED published to trade-events)
2. MarketDataListener consumes ORDER_FILLED
3. Calculates new position:
   \\
   Old: AAPL qty=10, avg_cost=
   New order: qty=5, execution_price=
   
   New avg_cost = (10*150 + 5*155) / (10+5)
               = (1500 + 775) / 15
               = 2275 / 15
               = .67
   \\
4. Updates portfolio_positions table with new avg_cost, quantity
5. When new quote arrives (market-data topic):
   - Updates current_price in portfolio_positions
   - Calculates unrealized_pnl = quantity * (current_price - avg_cost)

**Database**:
- Tables:
  \\sql
  portfolio_positions (
    id, account_id, symbol, quantity, avg_cost, 
    current_price, unrealized_pnl, last_updated
  )
  
  portfolio_holdings (
    id, account_id, total_value, total_pnl, last_updated
  )
  \\

**Test**:
- Portfolio service and listener tests (find in src/test/java)

---

### FEATURE 5: CHAT ASSISTANT (3 mins)

**What User Does**: Sends question about portfolio, receives LLM-powered analysis

**Frontend**:
- Component: Application/Frontend/frontend-app/src/app/features/chat/
- Chat interface, message input, response display

**Backend Endpoint**:
- POST /api/v1/accounts/{id}/chat
- Request: {message: "What's my best position?"}
- Response: {response: "Your best position is AAPL with +10% gain..."}

**Backend Service**:
- Package: com.team1.trading.api.chat
- Controller: ChatController.java
- Services:
  - ChatService.java (orchestrates LLM calls)
  - GeminiClient.java (calls Google Gemini LLM API)
  - PortfolioAnalytics.java (fetches portfolio, calculates metrics)
  - ChatTools.java (defines tools for LLM tool calling)
  - TechnicalIndicators.java (calculates TA indicators)

**Workflow**:
1. User sends message: "Should I sell AAPL?"
2. ChatService receives message
3. Fetches customer portfolio (read-only)
4. Builds context:
   \\json
   {
     "portfolio": {...},
     "recent_prices": {...},
     "market_conditions": {...}
   }
   \\
5. Calls Gemini API with:
   - message: "Should I sell AAPL?"
   - context: portfolio data
   - tools: [{get_portfolio, get_price, get_indicators, search_stocks}]
6. Gemini may call tools: "get_price(AAPL)" → ChatService executes → returns price
7. Gemini generates response using tool results
8. Returns to frontend

**Tools Available** (for LLM):
- get_portfolio() → customer positions with P&L
- get_price(symbol) → current price from market_quotes
- get_indicators(symbol) → MACD, RSI, etc. from daily_candles
- search_stocks(pattern) → find instruments matching pattern

**External Integration**:
- Google Gemini API: POST https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
- API key from vault: LLM_API_KEY

**Test**:
- ChatServiceTest.java (orchestration)
- ChatToolsTest.java (tool definitions)
- GeminiClientTest.java (LLM API calls)
- PortfolioAnalyticsTest.java (data fetching)

---

### Test References for Person 4
1. AlertEvaluationFlowTest.java (alert firing + notification)
2. WatchlistFlowTest.java (end-to-end watchlist workflow)
3. NotificationLedgerFlowTest.java (notification delivery states)
4. PreferenceControllerWebTest.java (preferences API)
5. ChatServiceTest.java (LLM integration)

### Viva Questions Person 4 Should Answer
1. "Walk me through price alert firing from quote consumption to notification delivery."
2. "What is a guarded UPDATE and why does AlertEvaluator use WHERE state = 'ARMED'?"
3. "Explain the notification_ledger delivery states (PENDING_CHANNEL, DELIVERY_FAILED, etc.)."
4. "Why is contact detail resolution done at send time (ADR 0003)?"
5. "How does the sweeper retry mechanism work for failed notifications?"
6. "Walk me through portfolio P&L calculation when an order fills."
7. "How does the chat assistant use tool calling to fetch portfolio data?"
8. "What Kafka topics and consumer groups does the watchlist module use?"
9. "Show me the price_alerts table and state transitions."
10. "If a user has no email and preference is EMAIL, what state does the notification have?"

---

## PERSON 5: TESTING & VERIFICATION (10 mins)

### Testing Strategy Overview

**Testing Pyramid**:
- 60% Unit tests (service logic, isolated)
- 25% Integration tests (multiple layers with real DB)
- 10% Controller/Web tests (HTTP API)
- 5% E2E tests (user workflows)

### SECTION 1: UNIT TESTS (2 mins)

**Framework**: JUnit 5, Mockito
**Location**: Application/Services/order-service/src/test/java/com/team1/trading/api/

**Examples**:
- AlertEvaluatorTest.java (test alert firing logic)
  \\java
  @Test
  void shouldFireAlertWhenPriceCrossesThreshold() {
    // Given: ARMED alert for AAPL with threshold  ABOVE
    // When: Quote updates to 
    // Then: alertEvaluator.evaluate() returns FIRE action
  }
  \\

- PreferenceServiceTest.java (test preference storage)
  \\java
  @Test
  void shouldUpdateChannelPreference() {
    // Given: Account with no preference
    // When: PATCH preference to EMAIL
    // Then: Database stores EMAIL channel
  }
  \\

- JwtValidatorTest.java (test JWT validation)
  \\java
  @Test
  void shouldValidateJwtSignature() {
    // Given: Valid JWT token
    // When: JwtValidator.validate(token)
    // Then: Returns claims (accountId, email, roles)
  }
  \\

### SECTION 2: INTEGRATION TESTS (3 mins)

**Framework**: TestContainers (PostgreSQL, Kafka)
**Location**: Application/Services/order-service/src/test/java/com/team1/trading/api/

**Primary Test**: OrderPlacementCharacterisationTest.java
\\
What it tests:
1. Order placement via HTTP POST /api/v1/orders
2. Database insertion (orders table)
3. Kafka publication (ORDER_PLACED event)
4. Idempotency (same order submitted twice)
5. Validation (invalid account, insufficient balance)

Setup:
- Starts real PostgreSQL container
- Starts real Kafka container
- Creates test data (accounts, instruments)
- Tests execute against real DB

Verifies:
- Order inserted with status = NEW
- UNIQUE constraint prevents duplicates
- EVENT published to Kafka orders topic
- Response contains orderId and confirmation
\\

**Other Integration Tests**:
- AlertEvaluationFlowTest.java (alert creation → quote → fire → notification)
  - Tests: Alert state transitions, guarded updates, notification call
  
- WatchlistFlowTest.java (complete watchlist workflow)
  - Tests: Watchlist creation, instrument addition, alert setup
  
- NotificationLedgerFlowTest.java (notification delivery and retry)
  - Tests: Delivery state tracking, sweeper retry logic
  
- AccountReadIntegrationTest.java (account retrieval)
  - Tests: GET account, balance calculation, order listing

### SECTION 3: CONTROLLER/WEB TESTS (2 mins)

**Framework**: Spring WebTestClient or MockMvc
**Location**: Application/Services/order-service/src/test/java/com/team1/trading/api/controller/

**Examples**:
- TradeApiControllerWebTest.java (HTTP API tests)
  \\java
  @Test
  void shouldPlaceOrderWithValidRequest() {
    // Given: POST /api/v1/orders {symbol, quantity, side, ...}
    // When: WebTestClient.post()
    // Then: HTTP 201 Created with orderId
  }
  
  @Test
  void shouldRejectOrderWithInsufficientBalance() {
    // Given: Balance = , order quantity = 100 @ /share
    // When: POST /api/v1/orders
    // Then: HTTP 400 Bad Request with error message
  }
  \\

- PreferenceControllerWebTest.java
  - Tests: GET /api/v1/preferences/{id}, PATCH /api/v1/preferences/{id}
  
- AlertControllerWebTest.java
  - Tests: POST /api/v1/alerts, PATCH /api/v1/alerts/{id}
  
- NotificationHistoryControllerWebTest.java
  - Tests: GET /api/v1/notifications/history with pagination

### SECTION 4: SECURITY TESTS (1 min)

**Framework**: JUnit 5, Mockito
**Location**: Application/Services/order-service/src/test/java/com/team1/trading/api/security/

**Key Tests**:
- JwtVerificationFilterTest.java (JWT validation on every request)
  \\java
  @Test
  void shouldRejectRequestWithoutAuthorizationHeader() {
    // Given: No Authorization header
    // When: Filter processes request
    // Then: Returns 401 Unauthorized
  }
  
  @Test
  void shouldRejectRequestWithExpiredToken() {
    // Given: Expired JWT token
    // When: Filter validates
    // Then: Returns 401 Unauthorized
  }
  \\

- HeaderTokenAccountIdResolverTest.java (account ID extraction)
  - Tests: Extract accountId from JWT claims

- ModuleRouteAuthorisationTest.java (access control)
  \\java
  @Test
  void shouldRejectUserAccessingOtherUserAccount() {
    // Given: User123's JWT, accessing Account456 data
    // When: GET /api/v1/accounts/456/orders
    // Then: Returns 403 Forbidden
  }
  \\

### SECTION 5: DATABASE SCHEMA TESTS (1 min)

**Framework**: pytest
**Location**: 	ests/test_schema_parity.py

**What it does**:
- Compares PostgreSQL schema against Java entity annotations
- Runs 62 checks:
  - Entity @Table name matches DB table name
  - @Column names match DB column names
  - @Column types match DB column types
  - @Id matches PRIMARY KEY
  - @OneToMany relationships match FK constraints
  - UNIQUE constraints present as expected

**Example**:
\\python
def test_order_idempotency_constraint():
    # Verify: UNIQUE(client_id, idempotency_key) exists on orders table
    # If violated: Duplicate order rejected
    
def test_order_status_enum_values():
    # Verify: Order status only allows NEW, FILLED, REJECTED, CANCELLED
\\

**Location**: 	ests/test_migrations.py
- Tests: All 30 migrations apply without error
- Checks: Schema versioning, immutability (migrations never edited)
- Verifies: Foreign key constraints, indexes, no schema drift

### SECTION 6: FRONTEND TESTS (1 min)

**Framework**: Vitest (unit), Playwright (E2E)
**Location**: Application/Frontend/frontend-app/

**Unit Tests** (*.spec.ts):
- OrderTicketPageComponent.spec.ts (form validation, submission)
- BlotterComponent.spec.ts (order list filtering)
- WatchlistComponent.spec.ts (watchlist CRUD)
- DashboardComponent.spec.ts (portfolio display)

**E2E Tests** (e2e/):
- Login flow end-to-end
- Order placement (fill form → submit → see in blotter)
- Watchlist creation and alert setup

### Running Tests

**Java tests**:
\\ash
# All tests
mvn test

# Specific test class
mvn test -Dtest=OrderPlacementCharacterisationTest

# Integration tests only
mvn test -Dgroups=integration
\\

**Frontend tests**:
\\ash
# Unit tests
npm test

# E2E tests
npm run test:e2e
\\

**Database tests**:
\\ash
pytest tests/
\\

### Key Test Files for Demonstration

**Must Show in Viva**:
1. **OrderPlacementCharacterisationTest.java** (15 min)
   - Show @SpringBootTest setup with TestContainers
   - Show valid order test
   - Show invalid account test
   - Show idempotency test (same order twice)
   - Show assertion pattern

2. **AlertEvaluationFlowTest.java** (10 min)
   - Show alert creation
   - Show quote consumption
   - Show state transition (ARMED → FIRED)
   - Show guarded update logic

3. **test_schema_parity.py** (5 min)
   - Show 62 validation checks
   - Show example check (entity @Table vs DB table)

4. **JwtVerificationFilterTest.java** (5 min)
   - Show missing token test (401)
   - Show expired token test (401)
   - Show valid token test (200)

### Viva Questions Person 5 Should Answer
1. "Show me OrderPlacementCharacterisationTest and walk through what it verifies."
2. "What is TestContainers and why is it used instead of mocked DB?"
3. "How do you test the guarded UPDATE pattern for alert firing?"
4. "What are the 62 schema parity checks?"
5. "Show me a JWT validation test and explain what it verifies."
6. "How do you test idempotency (same order submitted twice)?"
7. "What is the difference between unit tests and integration tests?"
8. "How do you run all tests in the project?"
9. "How do you test Kafka consumers and their interactions?"
10. "What test would catch an accidental database schema change?"

---

## RESPONSIBILITY MATRIX

| Component | P1 | P2 | P3 | P4 | P5 |
|-----------|----|----|----|----|-----|
| Domain Entities | ✓ | | | | |
| Database Schema | ✓ | | | | ✓ |
| JWT Validation | | ✓ | | | ✓ |
| Authorization | | ✓ | | | ✓ |
| Order Placement | | | ✓ | | |
| Order Execution | | | ✓ | | |
| Watchlists | | | | ✓ | |
| Alerts | | | | ✓ | |
| Notifications | | | | ✓ | |
| Preferences | | | | ✓ | |
| Portfolio | | | | ✓ | |
| Chat | | | | ✓ | |
| Unit Tests | | | | | ✓ |
| Integration Tests | | | | | ✓ |
| Security Tests | | ✓ | | | ✓ |
| Schema Tests | ✓ | | | | ✓ |

---

## PRESENTATION TIMELINE (90 mins)

| Person | Duration | Main Topics |
|--------|----------|-------------|
| **1** | 15 min | Domain model, UML, schema, constraints, relationships |
| **2** | 12 min | Auth flow, JWT, authorization, TrustMe vault, security |
| **3** | 20 min | Order placement (UI→API→DB→Kafka), execution, accounts, wallet |
| **4** | 20 min | Watchlists, alerts, notifications, preferences, portfolio, chat |
| **5** | 10 min | Testing strategy, key tests, running tests, schema parity |
| **Buffer** | 13 min | Q&A, transitions between speakers |
| **Total** | **90 mins** | |

---

## CRITICAL IMPLEMENTATION DETAILS TO MEMORIZE

**Person 1**:
- 8 entities, 10+ tables, UNIQUE(client_id, idempotency_key)
- Order status: NEW → FILLED → SETTLED
- Alert state: ARMED → FIRED

**Person 2**:
- JWT claims: sub, accountId, roles, iat, exp
- Filter runs on every /api/v1/* request
- TrustMe vault contains 10+ secrets

**Person 3**:
- Order placement: validate → insert → publish ORDER_PLACED
- Fill rule: BUY if ask ≤ limit, SELL if bid ≥ limit
- Guarded UPDATE: WHERE status = 'NEW'

**Person 4**:
- Alert evaluation: quote > threshold AND state = ARMED → fire
- Notification delivery: resolve channel → route → record state
- Preferences: store channel only, resolve email at send time
- Portfolio: avg_cost = (qty*cost + qty'*price) / total_qty

**Person 5**:
- OrderPlacementCharacterisationTest: 5 test scenarios
- TestContainers: real PostgreSQL + Kafka
- Schema parity: 62 checks comparing entities to tables
- 3 types of tests to show: unit, integration, controller
