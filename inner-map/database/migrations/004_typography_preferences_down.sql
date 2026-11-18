-- =============================================================
--  Inner Map - ROLLBACK of migration 004 (typography settings)
--  Removes only the typography column; every other preference is kept.
--  The app keeps working without it (typography then stays per-device in the browser).
-- =============================================================
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_preferences' AND COLUMN_NAME = 'typography'
);
SET @sql := IF(@col_exists = 1,
  'ALTER TABLE user_preferences DROP COLUMN typography',
  'SELECT ''typography column not present''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
