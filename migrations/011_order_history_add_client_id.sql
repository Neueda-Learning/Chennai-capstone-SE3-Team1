BEGIN;

ALTER TABLE order_history
    ADD COLUMN IF NOT EXISTS client_id BIGINT;

UPDATE order_history h
SET client_id = o.client_id
FROM orders o
WHERE h.order_id = o.order_id
  AND h.client_id IS NULL;

ALTER TABLE order_history
    ADD CONSTRAINT fk_order_history_client_id
    FOREIGN KEY (client_id) REFERENCES clients(client_id);

CREATE INDEX IF NOT EXISTS idx_order_history_client_id_timestamp
    ON order_history(client_id, event_timestamp DESC);

COMMIT;

