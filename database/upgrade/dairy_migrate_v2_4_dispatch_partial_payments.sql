-- Add payment amounts to farm dispatch sales to support partial payments.
-- Back up the database before running this migration.
USE dairy_app;

ALTER TABLE dispatches
  ADD COLUMN amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER payment_status;

UPDATE dispatches AS d
JOIN dispatch_items AS i ON i.dispatch_id = d.id
SET d.amount_paid = COALESCE(i.line_total, 0)
WHERE d.payment_status = 'PAID';

INSERT INTO schema_version (version) VALUES ('2.4');
