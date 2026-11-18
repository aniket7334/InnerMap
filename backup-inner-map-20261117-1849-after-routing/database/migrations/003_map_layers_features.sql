-- =============================================================
--  Inner Map - migration 003: geographical feature layers (KML/KMZ/GeoJSON + drawings)
--  Safe to run more than once. Import with phpMyAdmin (select inner_map_db -> Import)
--  or:  C:\xampp\mysql\bin\mysql.exe -u root inner_map_db < database\migrations\003_map_layers_features.sql
-- =============================================================

-- One row per imported file (KML/KMZ/GeoJSON) or per user drawing collection.
CREATE TABLE IF NOT EXISTS map_layers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  source      ENUM('imported','drawn') NOT NULL DEFAULT 'imported',
  file_name   VARCHAR(255) NULL,                 -- original file name for imports
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_map_layers_user (user_id),
  CONSTRAINT fk_map_layers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Markers, paths and polygons. Geometry is stored as GeoJSON (WGS84 lon/lat), which maps
-- 1:1 to KML Point / LineString / Polygon (and their Multi* variants).
CREATE TABLE IF NOT EXISTS map_features (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  layer_id       INT UNSIGNED NOT NULL,
  name           VARCHAR(255) NULL,
  description    TEXT NULL,                      -- plain text (HTML from KML is stripped)
  geometry_type  ENUM('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon') NOT NULL,
  geometry       MEDIUMTEXT NOT NULL,            -- GeoJSON geometry object
  style          TEXT NULL,                      -- JSON: stroke, strokeWidth, fill, fillOpacity, markerColor
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_map_features_layer (layer_id),
  KEY idx_map_features_user (user_id),
  CONSTRAINT fk_map_features_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_map_features_layer FOREIGN KEY (layer_id)
    REFERENCES map_layers (id) ON DELETE CASCADE
) ENGINE=InnoDB;
