-- Basisstructuur voor Vis Lokaties data in MySQL
CREATE DATABASE IF NOT EXISTS vis_trips CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vis_trips;

-- Waters en geometrie
CREATE TABLE IF NOT EXISTS waters (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  geojson JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Stekken (spots) met optionele waterkoppeling
CREATE TABLE IF NOT EXISTS steks (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  water_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_steks_water FOREIGN KEY (water_id) REFERENCES waters(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Rigspots per stek of water
CREATE TABLE IF NOT EXISTS rigs (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  stek_id VARCHAR(64) NULL,
  water_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rigs_stek FOREIGN KEY (stek_id) REFERENCES steks(id) ON DELETE SET NULL,
  CONSTRAINT fk_rigs_water FOREIGN KEY (water_id) REFERENCES waters(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Bathymetriepunten uit Deeper imports
CREATE TABLE IF NOT EXISTS bathy_points (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  depth_m DOUBLE NOT NULL,
  dataset VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bathy_latlon (lat, lon)
) ENGINE=InnoDB;

-- Metadata over bathymetrie datasets
CREATE TABLE IF NOT EXISTS bathy_datasets (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source VARCHAR(255) NULL,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  points INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- Algemene instellingen
CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(64) PRIMARY KEY,
  value JSON NOT NULL
) ENGINE=InnoDB;

-- Standaardinstelling voor waterkleur uit het origineel
INSERT INTO settings (name, value)
VALUES ('waterColor', '"#33a1ff"')
ON DUPLICATE KEY UPDATE value=VALUES(value);
