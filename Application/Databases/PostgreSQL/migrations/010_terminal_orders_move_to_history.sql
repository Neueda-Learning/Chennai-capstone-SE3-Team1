BEGIN;

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
    ADD CONSTRAINT chk_order_history_filled_has_executed_price
        CHECK (new_status <> 'FILLED' OR idempotency_key IS NULL OR executed_price IS NOT NULL);

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

ALTER TABLE order_history DROP CONSTRAINT order_history_order_id_fkey;

CREATE UNIQUE INDEX uq_order_history_idempotency_key
    ON order_history (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_order_history_client_id ON order_history (client_id);
CREATE INDEX idx_order_history_order_created_at ON order_history (order_created_at);

DELETE FROM orders WHERE status IN ('FILLED', 'REJECTED', 'CANCELLED');

ALTER TABLE orders DROP CONSTRAINT chk_orders_status;
ALTER TABLE orders ADD CONSTRAINT chk_orders_status CHECK (status = 'NEW');

COMMIT;
