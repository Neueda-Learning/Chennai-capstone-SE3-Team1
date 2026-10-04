BEGIN;

-- orders becomes a live book: it holds NEW (in-progress) orders only. When an order
-- reaches a terminal state the executor writes the terminal order_history row with the
-- order's own fields on it and deletes the orders row.
--
-- That means order_history has to carry what orders carried, or the details of every
-- completed trade are lost. Only the terminal row is populated: the CREATED row stays
-- a pure transition, so an order's quantity and price are recorded once, not twice.

ALTER TABLE order_history
    ADD COLUMN client_id        BIGINT,
    ADD COLUMN account_id       BIGINT,
    ADD COLUMN instrument_id    VARCHAR(20),
    ADD COLUMN order_type       VARCHAR(8),
    ADD COLUMN side             VARCHAR(4),
    ADD COLUMN quantity         DECIMAL(18,4),
    ADD COLUMN price            DECIMAL(18,4),
    ADD COLUMN executed_price   DECIMAL(18,4),
    ADD COLUMN idempotency_key  VARCHAR(100),
    ADD COLUMN order_created_at TIMESTAMP;

-- The same rules orders enforced, applied to the rows that now carry the values.
ALTER TABLE order_history
    ADD CONSTRAINT chk_order_history_order_type
        CHECK (order_type IS NULL OR order_type IN ('POSITION', 'HOLDING')),
    ADD CONSTRAINT chk_order_history_side
        CHECK (side IS NULL OR side IN ('BUY', 'SELL')),
    ADD CONSTRAINT chk_order_history_quantity_positive
        CHECK (quantity IS NULL OR quantity > 0),
    ADD CONSTRAINT chk_order_history_price_positive
        CHECK (price IS NULL OR price > 0),
    ADD CONSTRAINT chk_order_history_executed_price_positive
        CHECK (executed_price IS NULL OR executed_price > 0),
    -- a terminal row that says FILLED must say what it filled at
    ADD CONSTRAINT chk_order_history_filled_has_executed_price
        CHECK (new_status <> 'FILLED' OR idempotency_key IS NULL OR executed_price IS NOT NULL);

-- Backfill: every order already in a terminal state moves onto its terminal history row.
-- Done before the delete below, so nothing is lost on the way through.
UPDATE order_history h
   SET client_id        = o.client_id,
       account_id       = o.account_id,
       instrument_id    = o.instrument_id,
       order_type       = o.order_type,
       side             = o.side,
       quantity         = o.quantity,
       price            = o.price,
       executed_price   = o.executed_price,
       idempotency_key  = o.idempotency_key,
       order_created_at = o.created_at
  FROM orders o
 WHERE h.order_id = o.order_id
   AND o.status IN ('FILLED', 'REJECTED', 'CANCELLED')
   AND h.new_status = o.status
   AND h.history_id = (
        SELECT max(h2.history_id) FROM order_history h2
         WHERE h2.order_id = o.order_id AND h2.new_status = o.status
   );

-- An order that reached a terminal state without an order_history row to move onto
-- would vanish in the DELETE below. Give it one rather than lose it.
INSERT INTO order_history (
    order_id, event_type, previous_status, new_status, event_timestamp, created_at,
    client_id, account_id, instrument_id, order_type, side,
    quantity, price, executed_price, idempotency_key, order_created_at
)
SELECT o.order_id, o.status, 'NEW', o.status, o.updated_at, o.updated_at,
       o.client_id, o.account_id, o.instrument_id, o.order_type, o.side,
       o.quantity, o.price, o.executed_price, o.idempotency_key, o.created_at
  FROM orders o
 WHERE o.status IN ('FILLED', 'REJECTED', 'CANCELLED')
   AND NOT EXISTS (
        SELECT 1 FROM order_history h
         WHERE h.order_id = o.order_id AND h.idempotency_key IS NOT NULL
   );

-- The foreign key has to go: order_history now outlives the orders row it describes.
ALTER TABLE order_history DROP CONSTRAINT order_history_order_id_fkey;

-- Idempotency was a UNIQUE on orders.idempotency_key, and that is what refused a
-- duplicate submission. Deleting the orders row would free the key, so the constraint
-- moves here. Partial, because only the terminal row carries a key.
CREATE UNIQUE INDEX uq_order_history_idempotency_key
    ON order_history (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_order_history_client_id ON order_history (client_id);
CREATE INDEX idx_order_history_order_created_at ON order_history (order_created_at);

-- Now the orders row is redundant: everything it held is on the history row.
DELETE FROM orders WHERE status IN ('FILLED', 'REJECTED', 'CANCELLED');

-- And from here on orders may only hold live ones.
ALTER TABLE orders DROP CONSTRAINT chk_orders_status;
ALTER TABLE orders ADD CONSTRAINT chk_orders_status CHECK (status = 'NEW');

COMMIT;
