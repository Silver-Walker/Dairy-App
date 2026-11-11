-- Upgrade an EXISTING v1 database (the old dairy_schema_v1.sql) to VERSION 2 without losing data.
-- Take a backup first (mysqldump). Run once:  & $mysql -u root -p -e "source database/upgrade/dairy_migrate_v1_to_v2.sql"
-- If it stops with a foreign-key error, an existing row points at another business's record: fix that row, re-run
-- the statements from the failing one onward.
USE dairy_app;

-- 1. login security columns
ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active,
  ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_password,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count,
  ADD COLUMN last_login_at DATETIME NULL AFTER locked_until,
  ADD COLUMN password_changed_at DATETIME NULL AFTER last_login_at;

-- 2. (id, business_id) keys on every parent table
ALTER TABLE farms              ADD UNIQUE KEY uq_farm_biz (id, business_id);
ALTER TABLE shops              ADD UNIQUE KEY uq_shop_biz (id, business_id);
ALTER TABLE products           ADD UNIQUE KEY uq_product_biz (id, business_id);
ALTER TABLE dispatches         ADD UNIQUE KEY uq_dispatch_biz (id, business_id);
ALTER TABLE receipts           ADD UNIQUE KEY uq_receipt_biz (id, business_id);
ALTER TABLE processing_records ADD UNIQUE KEY uq_proc_biz (id, business_id);
ALTER TABLE sales              ADD UNIQUE KEY uq_sale_biz (id, business_id);
ALTER TABLE stock_closings     ADD UNIQUE KEY uq_closing_biz (id, business_id);
ALTER TABLE expense_categories ADD UNIQUE KEY uq_cat_biz (id, business_id);
ALTER TABLE cows               ADD UNIQUE KEY uq_cow_biz (id, business_id);
ALTER TABLE veterinary_records ADD UNIQUE KEY uq_vet_biz (id, business_id);
ALTER TABLE expenses           ADD UNIQUE KEY uq_expense_biz (id, business_id);

-- 3. business_id on the item tables (filled from the parent row), then made mandatory
ALTER TABLE dispatch_items      ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE receipt_items       ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE processing_items    ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE sale_items          ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE stock_closing_items ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE expense_payments    ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER id;
UPDATE dispatch_items i      JOIN dispatches p         ON p.id = i.dispatch_id   SET i.business_id = p.business_id;
UPDATE receipt_items i       JOIN receipts p           ON p.id = i.receipt_id    SET i.business_id = p.business_id;
UPDATE processing_items i    JOIN processing_records p ON p.id = i.processing_id SET i.business_id = p.business_id;
UPDATE sale_items i          JOIN sales p              ON p.id = i.sale_id       SET i.business_id = p.business_id;
UPDATE stock_closing_items i JOIN stock_closings p     ON p.id = i.closing_id    SET i.business_id = p.business_id;
UPDATE expense_payments i    JOIN expenses p           ON p.id = i.expense_id    SET i.business_id = p.business_id;
ALTER TABLE dispatch_items      MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE receipt_items       MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE processing_items    MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE sale_items          MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE stock_closing_items MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE expense_payments    MODIFY business_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE stock_closing_items ADD UNIQUE KEY uq_closing_item_biz (id, business_id);

-- 4. no duplicate product lines per dispatch / receipt
ALTER TABLE dispatch_items ADD UNIQUE KEY uq_dispatch_item_product (dispatch_id, product_id);
ALTER TABLE receipt_items  ADD UNIQUE KEY uq_receipt_item_product (receipt_id, product_id);

-- 5. tenant-safe foreign keys (added next to the old simple ones; the old ones stay, harmlessly)
ALTER TABLE product_prices ADD CONSTRAINT fk_t_price_product FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE milk_production ADD CONSTRAINT fk_t_prod_farm FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id);
ALTER TABLE dispatches ADD CONSTRAINT fk_t_disp_farm FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id),
                       ADD CONSTRAINT fk_t_disp_shop FOREIGN KEY (destination_shop_id, business_id) REFERENCES shops(id, business_id);
ALTER TABLE dispatch_items ADD CONSTRAINT fk_t_ditem_disp FOREIGN KEY (dispatch_id, business_id) REFERENCES dispatches(id, business_id),
                           ADD CONSTRAINT fk_t_ditem_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE receipts ADD CONSTRAINT fk_t_rec_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
                     ADD CONSTRAINT fk_t_rec_disp FOREIGN KEY (dispatch_id, business_id) REFERENCES dispatches(id, business_id);
ALTER TABLE receipt_items ADD CONSTRAINT fk_t_ritem_rec FOREIGN KEY (receipt_id, business_id) REFERENCES receipts(id, business_id),
                          ADD CONSTRAINT fk_t_ritem_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE processing_records ADD CONSTRAINT fk_t_proc_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id);
ALTER TABLE processing_items ADD CONSTRAINT fk_t_pitem_proc FOREIGN KEY (processing_id, business_id) REFERENCES processing_records(id, business_id),
                             ADD CONSTRAINT fk_t_pitem_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE sales ADD CONSTRAINT fk_t_sale_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id);
ALTER TABLE sale_items ADD CONSTRAINT fk_t_sitem_sale FOREIGN KEY (sale_id, business_id) REFERENCES sales(id, business_id),
                       ADD CONSTRAINT fk_t_sitem_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE stock_losses ADD CONSTRAINT fk_t_loss_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
                         ADD CONSTRAINT fk_t_loss_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE stock_movements ADD CONSTRAINT fk_t_mov_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
                            ADD CONSTRAINT fk_t_mov_farm FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id),
                            ADD CONSTRAINT fk_t_mov_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id);
ALTER TABLE stock_closings ADD CONSTRAINT fk_t_close_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id);
ALTER TABLE stock_closing_items ADD CONSTRAINT fk_t_citem_close FOREIGN KEY (closing_id, business_id) REFERENCES stock_closings(id, business_id),
                                ADD CONSTRAINT fk_t_citem_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id);
ALTER TABLE stock_adjustments ADD CONSTRAINT fk_t_adj_shop FOREIGN KEY (shop_id, business_id) REFERENCES shops(id, business_id),
                              ADD CONSTRAINT fk_t_adj_prod FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
                              ADD CONSTRAINT fk_t_adj_item FOREIGN KEY (closing_item_id, business_id) REFERENCES stock_closing_items(id, business_id);
ALTER TABLE cows ADD CONSTRAINT fk_t_cow_farm FOREIGN KEY (farm_id, business_id) REFERENCES farms(id, business_id);
ALTER TABLE veterinary_records ADD CONSTRAINT fk_t_vet_cow FOREIGN KEY (cow_id, business_id) REFERENCES cows(id, business_id);
ALTER TABLE expenses ADD CONSTRAINT fk_t_exp_cat FOREIGN KEY (category_id, business_id) REFERENCES expense_categories(id, business_id),
                     ADD CONSTRAINT fk_t_exp_vet FOREIGN KEY (veterinary_record_id, business_id) REFERENCES veterinary_records(id, business_id);
ALTER TABLE expense_payments ADD CONSTRAINT fk_t_pay_exp FOREIGN KEY (expense_id, business_id) REFERENCES expenses(id, business_id);

-- 6. opening stock + in-transit view
CREATE TABLE opening_balances (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id      BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  farm_id          BIGINT UNSIGNED NULL,
  shop_id          BIGINT UNSIGNED NULL,
  quantity_litres  DECIMAL(12,3) NOT NULL CHECK (quantity_litres >= 0),
  as_of            DATETIME NOT NULL,
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

CREATE VIEW v_stock_in_transit AS
SELECT d.business_id, d.destination_shop_id AS shop_id, di.product_id,
       SUM(di.quantity_litres) AS in_transit_litres
FROM dispatches d
JOIN dispatch_items di ON di.dispatch_id = d.id
LEFT JOIN receipts r ON r.dispatch_id = d.id
WHERE d.destination_type = 'SHOP' AND r.id IS NULL
GROUP BY d.business_id, d.destination_shop_id, di.product_id;

ALTER TABLE audit_logs ADD INDEX idx_audit_time (business_id, created_at);
CREATE TABLE schema_version (
  version     VARCHAR(20) NOT NULL PRIMARY KEY,
  applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO schema_version (version) VALUES ('2.0');
SELECT 'Migration to version 2 finished' AS result;
