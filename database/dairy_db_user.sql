-- Run ONCE as MySQL root, AFTER dairy_schema_v1.sql. Change the password first!
CREATE USER IF NOT EXISTS 'dairy_user'@'localhost' IDENTIFIED BY 'Allann3020';
GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON dairy_app.* TO 'dairy_user'@'localhost';
FLUSH PRIVILEGES;
-- The app user cannot DROP/ALTER tables: safer if the app is ever compromised.
