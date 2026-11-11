-- =====================================================================
-- Dairy Farm Management System - MySQL 8.0.16+ schema  (VERSION 2.2)
-- This ONE file is the complete database. It replaces the earlier v1.0 and v1.1 files.
--
-- Run (Windows PowerShell):  & $mysql -u root -p -e "source database/dairy_schema_v2.sql"
--
-- Highlights:
--  * Multi-business and tenant-safe: composite foreign keys (id, business_id) mean the database itself refuses
--    a record that points at another business's farm / shop / product / dispatch.
--  * Ledger-based stock (stock_movements) with opening balances, daily closings and owner-approved adjustments.
--  * Stock in transit view, dispatch/receipt discrepancy view, derived expense payment status.
--  * Login security columns (lockout, temporary passwords) and an append-only audit log.
--  * schema_version table so the app can tell which version a database is.
-- Already have a v1 database with data? Do NOT run this file: use database/upgrade/dairy_migrate_v1_to_v2.sql.
-- =====================================================================
CREATE DATABASE IF NOT EXISTS dairy_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dairy_app;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- A. BUSINESS, USERS, LOCATIONS
-- ---------------------------------------------------------------------
CREATE TABLE businesses (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  status      ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Which version of this schema the database is on (used by "check-db" and by future upgrades)
CREATE TABLE schema_version (
  version     VARCHAR(20) NOT NULL PRIMARY KEY,
  applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO schema_version (version) VALUES ('2.2');

CREATE TABLE business_settings (
  business_id            BIGINT UNSIGNED PRIMARY KEY,
  timezone               VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
  closing_deadline_time  TIME NOT NULL DEFAULT '12:00:00',   -- applies to the following day
  discrepancy_threshold_litres DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  currency               CHAR(3) NOT NULL DEFAULT 'KES',
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE users (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username              VARCHAR(80)  NOT NULL UNIQUE,
  email                 VARCHAR(255) NULL UNIQUE,
  password_hash         VARCHAR(255) NOT NULL,
  full_name             VARCHAR(150) NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,      -- TRUE after the owner sets a temporary password
  failed_login_count    INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until          DATETIME NULL,                       -- login blocked until this time (UTC)
  last_login_at         DATETIME NULL,
  password_changed_at   DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE auth_sessions (
  token_hash  CHAR(64) NOT NULL PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  business_id BIGINT UNSIGNED NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_session_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE business_memberships (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  role         ENUM('OWNER','MILKER','SHOP_ATTENDANT') NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_member (business_id, user_id, role),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE farms (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(150) NOT NULL,
  location     VARCHAR(255) NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_farm_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE shops (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(150) NOT NULL,
  location     VARCHAR(255) NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_shop_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- B. PRODUCTS & PRICES
-- ---------------------------------------------------------------------
CREATE TABLE products (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id   BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(100) NOT NULL,
  product_type  ENUM('FRESH_MILK','YOGHURT','MAZIWA_MALA') NOT NULL,
  unit          VARCHAR(20) NOT NULL DEFAULT 'LITRE',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_product_type (business_id, product_type),
  UNIQUE KEY uq_product_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE product_prices (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id    BIGINT UNSIGNED NOT NULL,
  product_id     BIGINT UNSIGNED NOT NULL,
  selling_price  DECIMAL(12,2) NOT NULL CHECK (selling_price >= 0),
  effective_from DATETIME NOT NULL,
  created_by     BIGINT UNSIGNED NOT NULL,
  INDEX idx_price_lookup (product_id, effective_from),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
  FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- C. MILK PRODUCTION
-- ---------------------------------------------------------------------
CREATE TABLE milk_production (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid      CHAR(36) NULL,                       -- offline idempotency key
  business_id      BIGINT UNSIGNED NOT NULL,
  farm_id          BIGINT UNSIGNED NOT NULL,
  session          ENUM('MORNING','LUNCH','EVENING') NOT NULL,
  production_date  DATE NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres >= 0),
  recorded_by      BIGINT UNSIGNED NOT NULL,
  entered_at       DATETIME NOT NULL,                   -- original (possibly offline) entry time
  synced_at        DATETIME NULL,
  notes            TEXT NULL,
  UNIQUE KEY uq_prod_session (farm_id, production_date, session),
  UNIQUE KEY uq_prod_client (business_id, client_uuid),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- D. DISPATCHES & RECEIPTS
-- ---------------------------------------------------------------------
CREATE TABLE dispatches (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference         VARCHAR(30) NOT NULL,               -- e.g. DSP-20261030-0001
  client_uuid       CHAR(36) NULL,
  business_id       BIGINT UNSIGNED NOT NULL,
  farm_id           BIGINT UNSIGNED NOT NULL,
  destination_type  ENUM('SHOP','EXTERNAL') NOT NULL,
  destination_shop_id BIGINT UNSIGNED NULL,
  destination_name  VARCHAR(150) NULL,
  dispatched_at     DATETIME NOT NULL,
  dispatch_type     ENUM('TRANSFER','SALE','NON_SALE') NOT NULL,
  price_per_litre   DECIMAL(12,2) NULL,                 -- external sale only
  payment_status    VARCHAR(10) NULL,                   -- tracked for owner-recorded buyer sales
  non_sale_reason   VARCHAR(255) NULL,                  -- external non-sale only
  recorded_by       BIGINT UNSIGNED NOT NULL,
  entered_at        DATETIME NOT NULL,
  synced_at         DATETIME NULL,
  notes             TEXT NULL,
  UNIQUE KEY uq_dispatch_ref (business_id, reference),
  UNIQUE KEY uq_dispatch_client (business_id, client_uuid),
  UNIQUE KEY uq_dispatch_biz (id, business_id),
  INDEX idx_dispatch_date (business_id, dispatched_at),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (farm_id, business_id)             REFERENCES farms(id, business_id),
  FOREIGN KEY (destination_shop_id, business_id) REFERENCES shops(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT chk_dispatch_rules CHECK (
    (destination_type = 'SHOP'
       AND dispatch_type = 'TRANSFER'
       AND destination_shop_id IS NOT NULL
       AND price_per_litre IS NULL AND non_sale_reason IS NULL)
    OR
    (destination_type = 'EXTERNAL'
       AND dispatch_type = 'SALE'
       AND price_per_litre IS NOT NULL AND non_sale_reason IS NULL)
    OR
    (destination_type = 'EXTERNAL'
       AND dispatch_type = 'NON_SALE'
       AND non_sale_reason IS NOT NULL AND price_per_litre IS NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE dispatch_items (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  dispatch_id      BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres > 0),
  line_total       DECIMAL(14,2) NULL,                  -- filled for external SALE
  UNIQUE KEY uq_dispatch_item_product (dispatch_id, product_id),
  FOREIGN KEY (dispatch_id, business_id) REFERENCES dispatches(id, business_id),
  FOREIGN KEY (product_id,  business_id) REFERENCES products(id, business_id)
) ENGINE=InnoDB;

CREATE TABLE receipts (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid  CHAR(36) NULL,
  business_id  BIGINT UNSIGNED NOT NULL,
  shop_id      BIGINT UNSIGNED NOT NULL,
  dispatch_id  BIGINT UNSIGNED NULL,
  received_at  DATETIME NOT NULL,
  recorded_by  BIGINT UNSIGNED NOT NULL,
  entered_at   DATETIME NOT NULL,
  synced_at    DATETIME NULL,
  notes        TEXT NULL,
  UNIQUE KEY uq_receipt_dispatch (dispatch_id),         -- one receipt per dispatch (v1)
  UNIQUE KEY uq_receipt_client (business_id, client_uuid),
  UNIQUE KEY uq_receipt_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id)     REFERENCES shops(id, business_id),
  FOREIGN KEY (dispatch_id, business_id) REFERENCES dispatches(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE receipt_items (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  receipt_id       BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres >= 0),
  UNIQUE KEY uq_receipt_item_product (receipt_id, product_id),
  FOREIGN KEY (receipt_id, business_id) REFERENCES receipts(id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- E. PROCESSING
-- ---------------------------------------------------------------------
CREATE TABLE processing_records (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid   CHAR(36) NULL,
  business_id   BIGINT UNSIGNED NOT NULL,
  shop_id       BIGINT UNSIGNED NOT NULL,
  processed_at  DATETIME NOT NULL,
  recorded_by   BIGINT UNSIGNED NOT NULL,
  entered_at    DATETIME NOT NULL,
  synced_at     DATETIME NULL,
  notes         TEXT NULL,
  UNIQUE KEY uq_proc_client (business_id, client_uuid),
  UNIQUE KEY uq_proc_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE processing_items (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  processing_id    BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  movement_type    ENUM('INPUT','OUTPUT') NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres > 0),
  UNIQUE KEY uq_proc_item (processing_id, product_id, movement_type),
  FOREIGN KEY (processing_id, business_id) REFERENCES processing_records(id, business_id),
  FOREIGN KEY (product_id, business_id)    REFERENCES products(id, business_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- F. SALES
-- ---------------------------------------------------------------------
CREATE TABLE sales (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid  CHAR(36) NULL,
  business_id  BIGINT UNSIGNED NOT NULL,
  shop_id      BIGINT UNSIGNED NOT NULL,
  sale_date    DATE NOT NULL,
  recorded_by  BIGINT UNSIGNED NOT NULL,
  entered_at   DATETIME NOT NULL,
  synced_at    DATETIME NULL,
  notes        TEXT NULL,
  UNIQUE KEY uq_sale_client (business_id, client_uuid),
  UNIQUE KEY uq_sale_biz (id, business_id),
  INDEX idx_sale_date (shop_id, sale_date),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE sale_items (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  sale_id          BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres > 0),
  unit_price       DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),   -- frozen at time of sale
  line_total       DECIMAL(14,2) NOT NULL,                           -- qty * unit_price, set by app
  FOREIGN KEY (sale_id, business_id)    REFERENCES sales(id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- G. STOCK LEDGER, OPENING STOCK, LOSSES, CLOSINGS
-- ---------------------------------------------------------------------
CREATE TABLE stock_losses (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid      CHAR(36) NULL,
  business_id      BIGINT UNSIGNED NOT NULL,
  shop_id          BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres > 0),
  loss_reason      ENUM('SPOILAGE','EXPIRY','SPILLAGE','OTHER') NOT NULL,
  occurred_at      DATETIME NOT NULL,
  recorded_by      BIGINT UNSIGNED NOT NULL,
  entered_at       DATETIME NOT NULL,
  synced_at        DATETIME NULL,
  notes            TEXT NULL,
  UNIQUE KEY uq_loss_client (business_id, client_uuid),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id)    REFERENCES shops(id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Starting stock when a business begins using the system (one row per place and product).
CREATE TABLE opening_balances (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  farm_id          BIGINT UNSIGNED NULL,
  shop_id          BIGINT UNSIGNED NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres >= 0),
  as_of            DATETIME NOT NULL,                   -- stock level at this moment (UTC)
  recorded_by      BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_opening_farm (farm_id, product_id),
  UNIQUE KEY uq_opening_shop (shop_id, product_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
  FOREIGN KEY (farm_id, business_id)    REFERENCES farms(id, business_id),
  FOREIGN KEY (shop_id, business_id)    REFERENCES shops(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT chk_opening_one_location CHECK (
    (farm_id IS NOT NULL AND shop_id IS NULL) OR (farm_id IS NULL AND shop_id IS NOT NULL))
) ENGINE=InnoDB;

-- Source of truth for inventory. Exactly one of farm_id / shop_id is set.
CREATE TABLE stock_movements (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  farm_id         BIGINT UNSIGNED NULL,
  shop_id         BIGINT UNSIGNED NULL,
  movement_type   ENUM('OPENING_BALANCE','PRODUCTION','DISPATCH','RECEIPT',
                       'PROCESSING_INPUT','PROCESSING_OUTPUT','SALE','LOSS',
                       'ADJUSTMENT','REVERSAL') NOT NULL,
  quantity_delta  DECIMAL(12,3) NOT NULL,               -- + increases, - decreases
  source_type     VARCHAR(30) NOT NULL,                 -- e.g. DISPATCH_ITEM, SALE_ITEM
  source_id       BIGINT UNSIGNED NOT NULL,
  occurred_at     DATETIME NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_movement_once (business_id, source_type, source_id, movement_type),
  INDEX idx_stock_shop (shop_id, product_id, occurred_at),
  INDEX idx_stock_farm (farm_id, product_id, occurred_at),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
  FOREIGN KEY (farm_id, business_id)    REFERENCES farms(id, business_id),
  FOREIGN KEY (shop_id, business_id)    REFERENCES shops(id, business_id),
  FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT chk_one_location CHECK (
    (farm_id IS NOT NULL AND shop_id IS NULL) OR
    (farm_id IS NULL AND shop_id IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE stock_closings (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid   CHAR(36) NULL,
  business_id   BIGINT UNSIGNED NOT NULL,
  shop_id       BIGINT UNSIGNED NOT NULL,
  closing_date  DATE NOT NULL,
  status        ENUM('DRAFT','SUBMITTED','REVIEW_REQUIRED','REVIEWED') NOT NULL DEFAULT 'DRAFT',
  is_late       BOOLEAN NOT NULL DEFAULT FALSE,         -- submitted after deadline
  is_provisional BOOLEAN NOT NULL DEFAULT FALSE,        -- depends on an unresolved earlier closing
  submitted_by  BIGINT UNSIGNED NOT NULL,
  entered_at    DATETIME NOT NULL,
  submitted_at  DATETIME NULL,
  synced_at     DATETIME NULL,
  notes         TEXT NULL,
  UNIQUE KEY uq_closing_day (shop_id, closing_date),
  UNIQUE KEY uq_closing_client (business_id, client_uuid),
  UNIQUE KEY uq_closing_biz (id, business_id),
  FOREIGN KEY (business_id)  REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
  FOREIGN KEY (submitted_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE stock_closing_items (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id       BIGINT UNSIGNED NOT NULL,
  closing_id        BIGINT UNSIGNED NOT NULL,
  product_id        BIGINT UNSIGNED NOT NULL,
  expected_quantity DECIMAL(12,3) NOT NULL,
  physical_quantity DECIMAL(12,3) NOT NULL CHECK (physical_quantity >= 0),
  variance_quantity DECIMAL(12,3) NOT NULL,             -- physical - expected
  UNIQUE KEY uq_closing_product (closing_id, product_id),
  UNIQUE KEY uq_closing_item_biz (id, business_id),
  FOREIGN KEY (closing_id, business_id) REFERENCES stock_closings(id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id)
) ENGINE=InnoDB;

-- Owner-approved adjustments (creates an ADJUSTMENT movement)
CREATE TABLE stock_adjustments (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  shop_id          BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  closing_item_id  BIGINT UNSIGNED NULL,
  quantity_delta   DECIMAL(12,3) NOT NULL,
  reason           VARCHAR(255) NOT NULL,
  approved_by      BIGINT UNSIGNED NOT NULL,
  approved_at      DATETIME NOT NULL,
  FOREIGN KEY (business_id)     REFERENCES businesses(id),
  FOREIGN KEY (shop_id, business_id)         REFERENCES shops(id, business_id),
  FOREIGN KEY (product_id, business_id)      REFERENCES products(id, business_id),
  FOREIGN KEY (closing_item_id, business_id) REFERENCES stock_closing_items(id, business_id),
  FOREIGN KEY (approved_by)     REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- H. EXPENSES & VETERINARY
-- ---------------------------------------------------------------------
CREATE TABLE expense_categories (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(80) NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_cat (business_id, name),
  UNIQUE KEY uq_cat_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE cows (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  farm_id      BIGINT UNSIGNED NOT NULL,
  tag_number   VARCHAR(80) NOT NULL,
  name         VARCHAR(100) NULL,
  status       ENUM('ACTIVE','SOLD','DECEASED','OTHER') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE KEY uq_cow_tag (business_id, tag_number),
  UNIQUE KEY uq_cow_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id)
) ENGINE=InnoDB;

CREATE TABLE veterinary_records (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  cow_id           BIGINT UNSIGNED NOT NULL,
  visit_date       DATE NOT NULL,
  concern          TEXT NOT NULL,
  diagnosis        TEXT NULL,
  treatment        TEXT NULL,
  medication       TEXT NULL,
  veterinarian     VARCHAR(150) NULL,
  follow_up_date   DATE NULL,
  cost             DECIMAL(14,2) NULL,                  -- informational; money lives in expenses
  notes            TEXT NULL,
  recorded_by      BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vet_followup (business_id, follow_up_date),
  UNIQUE KEY uq_vet_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (cow_id, business_id) REFERENCES cows(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE expenses (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id           BIGINT UNSIGNED NOT NULL,
  category_id           BIGINT UNSIGNED NOT NULL,
  veterinary_record_id  BIGINT UNSIGNED NULL UNIQUE,    -- one expense per vet record => counted once
  expense_date          DATE NOT NULL,                  -- date incurred
  amount                DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  description           TEXT NULL,
  recorded_by           BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expense_date (business_id, expense_date),
  UNIQUE KEY uq_expense_biz (id, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (category_id, business_id)          REFERENCES expense_categories(id, business_id),
  FOREIGN KEY (veterinary_record_id, business_id) REFERENCES veterinary_records(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Payment status is DERIVED: SUM(payments) vs expenses.amount (no stored status to drift)
CREATE TABLE expense_payments (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id   BIGINT UNSIGNED NOT NULL,
  expense_id    BIGINT UNSIGNED NOT NULL,
  amount        DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  payment_date  DATE NOT NULL,
  recorded_by   BIGINT UNSIGNED NOT NULL,
  notes         TEXT NULL,
  FOREIGN KEY (expense_id, business_id) REFERENCES expenses(id, business_id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- I. ADMINISTRATION: CORRECTIONS, NOTIFICATIONS, AUDIT, SYNC
-- ---------------------------------------------------------------------
CREATE TABLE correction_requests (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id           BIGINT UNSIGNED NOT NULL,
  record_type           VARCHAR(40) NOT NULL,
  record_id             BIGINT UNSIGNED NOT NULL,
  requested_by          BIGINT UNSIGNED NOT NULL,
  reason                TEXT NOT NULL,
  original_values_json  JSON NOT NULL,
  proposed_values_json  JSON NOT NULL,
  status                ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by           BIGINT UNSIGNED NULL,
  reviewed_at           DATETIME NULL,
  review_notes          TEXT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_corr_status (business_id, status),
  FOREIGN KEY (business_id)  REFERENCES businesses(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by)  REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id          BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,
  notification_type    ENUM('CLOSING_OVERDUE','STOCK_DISCREPANCY','DISPATCH_DISCREPANCY',
                            'CORRECTION_REQUEST','VET_FOLLOWUP','OTHER') NOT NULL,
  title                VARCHAR(150) NOT NULL,
  message              TEXT NOT NULL,
  related_record_type  VARCHAR(40) NULL,
  related_record_id    BIGINT UNSIGNED NULL,
  is_read              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at              DATETIME NULL,
  INDEX idx_notif_user (user_id, is_read),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,
  action           VARCHAR(40) NOT NULL,
  record_type      VARCHAR(40) NOT NULL,
  record_id        BIGINT UNSIGNED NULL,
  old_values_json  JSON NULL,
  new_values_json  JSON NULL,
  reason           TEXT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_rec (business_id, record_type, record_id),
  INDEX idx_audit_time (business_id, created_at),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- Make audit log append-only
DELIMITER $$
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
$$
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
$$
DELIMITER ;

CREATE TABLE sync_operations (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id        BIGINT UNSIGNED NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  client_operation_id CHAR(36) NOT NULL,
  device_id          VARCHAR(64) NULL,
  entity_type        VARCHAR(40) NOT NULL,
  local_record_id    VARCHAR(64) NULL,
  server_record_id   BIGINT UNSIGNED NULL,
  status             ENUM('PENDING','SYNCED','FAILED','CONFLICT') NOT NULL DEFAULT 'PENDING',
  created_at         DATETIME NOT NULL,                 -- client time
  synced_at          DATETIME NULL,
  error_message      TEXT NULL,
  UNIQUE KEY uq_sync_op (business_id, client_operation_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------
CREATE VIEW v_stock_balance AS
SELECT business_id, farm_id, shop_id, product_id, SUM(quantity_delta) AS balance
FROM stock_movements
GROUP BY business_id, farm_id, shop_id, product_id;

-- Milk that has left the farm for a shop but has not been received yet.
CREATE VIEW v_stock_in_transit AS
SELECT d.business_id, d.destination_shop_id AS shop_id, di.product_id,
       SUM(di.quantity_litres) AS in_transit_litres
FROM dispatches d
JOIN dispatch_items di ON di.dispatch_id = d.id
LEFT JOIN receipts r ON r.dispatch_id = d.id
WHERE d.destination_type = 'SHOP' AND r.id IS NULL
GROUP BY d.business_id, d.destination_shop_id, di.product_id;

CREATE VIEW v_dispatch_discrepancies AS
SELECT d.id AS dispatch_id, d.reference, d.dispatched_at,
       di.quantity_litres AS dispatched_litres,
       COALESCE(ri.quantity_litres, 0) AS received_litres,
       COALESCE(ri.quantity_litres, 0) - di.quantity_litres AS difference,
       CASE WHEN r.id IS NULL THEN 'NOT_RECEIVED'
            WHEN ri.quantity_litres <> di.quantity_litres THEN 'DISCREPANCY'
            ELSE 'MATCHED' END AS status
FROM dispatches d
JOIN dispatch_items di ON di.dispatch_id = d.id
LEFT JOIN receipts r ON r.dispatch_id = d.id
LEFT JOIN receipt_items ri ON ri.receipt_id = r.id AND ri.product_id = di.product_id
WHERE d.destination_type = 'SHOP';

CREATE VIEW v_expense_status AS
SELECT e.id, e.business_id, e.amount,
       COALESCE(SUM(p.amount), 0) AS paid,
       e.amount - COALESCE(SUM(p.amount), 0) AS balance_due,
       CASE WHEN COALESCE(SUM(p.amount),0) = 0 THEN 'UNPAID'
            WHEN COALESCE(SUM(p.amount),0) < e.amount THEN 'PARTIALLY_PAID'
            ELSE 'PAID' END AS payment_status
FROM expenses e
LEFT JOIN expense_payments p ON p.expense_id = e.id
GROUP BY e.id, e.business_id, e.amount;

-- No users or business are created here. The first owner account is created on the web page the first time you open the app.
