-- =============================================================
--  Inner Map - MySQL schema
--  Import with phpMyAdmin (Import tab) or:
--    C:\xampp\mysql\bin\mysql.exe -u root < database\inner_map_db.sql
-- =============================================================

CREATE DATABASE IF NOT EXISTS inner_map_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inner_map_db;

-- -------------------------------------------------------------
-- users
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(191) NOT NULL,
  password    VARCHAR(255) NOT NULL,             -- bcrypt hash, never plain text
  location_history_enabled TINYINT(1) NOT NULL DEFAULT 0,
  location_history_consent_at DATETIME NULL,     -- when the user accepted the privacy notice
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- saved_locations
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_locations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  location_name VARCHAR(100) NOT NULL,
  latitude      DECIMAL(10,7) NOT NULL,
  longitude     DECIMAL(10,7) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_saved_locations_user (user_id),
  CONSTRAINT fk_saved_locations_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- downloaded_maps  (metadata only - tiles live in the browser's IndexedDB)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downloaded_maps (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  map_name        VARCHAR(100) NOT NULL,
  region          TEXT NOT NULL,                 -- JSON: {"south":..,"west":..,"north":..,"east":..}
  zoom_min        TINYINT UNSIGNED NOT NULL,
  zoom_max        TINYINT UNSIGNED NOT NULL,
  storage_size    BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- bytes
  download_status ENUM('pending','downloading','completed','partial','failed','cancelled')
                  NOT NULL DEFAULT 'completed',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_downloaded_maps_user (user_id),
  CONSTRAINT fk_downloaded_maps_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- user_preferences  (map provider + default view + typography; also in migrations/002, 004)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id               INT UNSIGNED NOT NULL,
  map_provider          VARCHAR(50)  NOT NULL DEFAULT 'local-vector',
  default_lat           DECIMAL(10,7) NULL,
  default_lng           DECIMAL(10,7) NULL,
  default_zoom          TINYINT UNSIGNED NULL,
  show_downloaded_areas TINYINT(1)   NOT NULL DEFAULT 1,
  typography            TEXT         NULL DEFAULT NULL,   -- JSON font settings (migration 004)
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- map_layers / map_features  (KML/KMZ/GeoJSON imports + drawings; also in migrations/003)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_layers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  source      ENUM('imported','drawn') NOT NULL DEFAULT 'imported',
  file_name   VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_map_layers_user (user_id),
  CONSTRAINT fk_map_layers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS map_features (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  layer_id       INT UNSIGNED NOT NULL,
  name           VARCHAR(255) NULL,
  description    TEXT NULL,
  geometry_type  ENUM('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon') NOT NULL,
  geometry       MEDIUMTEXT NOT NULL,
  style          TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_map_features_layer (layer_id),
  KEY idx_map_features_user (user_id),
  CONSTRAINT fk_map_features_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_map_features_layer FOREIGN KEY (layer_id)
    REFERENCES map_layers (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- location_history  (only written when the user opted in)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  latitude    DECIMAL(10,7) NOT NULL,
  longitude   DECIMAL(10,7) NOT NULL,
  accuracy    FLOAT NULL,                        -- metres, if the browser reported it
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_location_history_user_time (user_id, recorded_at),
  CONSTRAINT fk_location_history_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
