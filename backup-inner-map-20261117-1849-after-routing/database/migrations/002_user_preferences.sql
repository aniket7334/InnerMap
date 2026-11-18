-- =============================================================
--  Inner Map - migration 002: user map preferences
--  Safe to run more than once. Import with phpMyAdmin (select inner_map_db -> Import)
--  or:  C:\xampp\mysql\bin\mysql.exe -u root inner_map_db < database\migrations\002_user_preferences.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id               INT UNSIGNED NOT NULL,
  map_provider          VARCHAR(50)  NOT NULL DEFAULT 'local-vector',  -- id from frontend/src/maps/providers.js
  default_lat           DECIMAL(10,7) NULL,                            -- last/home map view
  default_lng           DECIMAL(10,7) NULL,
  default_zoom          TINYINT UNSIGNED NULL,
  show_downloaded_areas TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
