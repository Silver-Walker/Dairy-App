-- Upgrade a v2.1 database for owner buyer-sale payment tracking.
-- Back up the database before running this migration.
USE dairy_app;

ALTER TABLE dispatches
  ADD COLUMN payment_status VARCHAR(10) NULL AFTER price_per_litre;

INSERT INTO schema_version (version) VALUES ('2.2');
