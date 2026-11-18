-- =============================================================
--  Inner Map - migration 004: typography / font settings
--  Additive: one NULLable column on user_preferences. Existing rows keep their
--  values; NULL means "use the default typography". Safe to run more than once.
--  Import with phpMyAdmin (select inner_map_db -> Import) or:
--    C:\xampp\mysql\bin\mysql.exe -u root inner_map_db < database\migrations\004_typography_preferences.sql
--  Rollback: database\migrations\004_typography_preferences_down.sql
-- =============================================================

-- JSON document (stored as TEXT for MariaDB/MySQL compatibility), validated and
-- whitelisted by the API: font family, size, weight, appearance, per-section
-- scaling and map label settings. Max 4 KB is enforced by the API.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_preferences' AND COLUMN_NAME = 'typography'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE user_preferences ADD COLUMN typography TEXT NULL DEFAULT NULL AFTER show_downloaded_areas',
  'SELECT ''typography column already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
