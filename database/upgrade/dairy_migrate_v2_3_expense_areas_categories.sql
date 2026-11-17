-- Add expense locations and standard expense categories for existing businesses.
-- Back up the database before running this migration.
USE dairy_app;

ALTER TABLE expenses
  ADD COLUMN area VARCHAR(10) NULL AFTER veterinary_record_id;

UPDATE expense_categories
SET is_active = FALSE
WHERE name NOT IN (
  'Feeds', 'Veterinary', 'Salaries', 'Electricity', 'Water',
  'Maintenance', 'Transport', 'Equipment', 'Rent', 'Other'
);

INSERT INTO expense_categories (business_id, name, is_active)
SELECT b.id, c.name, TRUE
FROM businesses AS b
CROSS JOIN (
  SELECT 'Feeds' AS name
  UNION ALL SELECT 'Veterinary'
  UNION ALL SELECT 'Salaries'
  UNION ALL SELECT 'Electricity'
  UNION ALL SELECT 'Water'
  UNION ALL SELECT 'Maintenance'
  UNION ALL SELECT 'Transport'
  UNION ALL SELECT 'Equipment'
  UNION ALL SELECT 'Rent'
  UNION ALL SELECT 'Other'
) AS c
LEFT JOIN expense_categories AS existing
  ON existing.business_id = b.id AND existing.name = c.name
WHERE existing.id IS NULL;

UPDATE expense_categories
SET is_active = TRUE
WHERE name IN (
  'Feeds', 'Veterinary', 'Salaries', 'Electricity', 'Water',
  'Maintenance', 'Transport', 'Equipment', 'Rent', 'Other'
);

INSERT INTO schema_version (version) VALUES ('2.3');
