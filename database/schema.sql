-- Database en tabel voor Vis Trips
CREATE DATABASE IF NOT EXISTS vis_trips;
USE vis_trips;

CREATE TABLE IF NOT EXISTS trips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  traveler_name VARCHAR(100) NOT NULL,
  destination VARCHAR(150) NOT NULL,
  trip_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
