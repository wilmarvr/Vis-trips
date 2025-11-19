require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vis_trips',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      traveler_name VARCHAR(100) NOT NULL,
      destination VARCHAR(150) NOT NULL,
      trip_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    res.json({ status: 'ok', result: rows[0].result });
  } catch (error) {
    console.error('Health check failed', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

app.get('/api/trips', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, traveler_name, destination, trip_date, notes, created_at FROM trips ORDER BY trip_date DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Failed to fetch trips', error);
    res.status(500).json({ message: 'Could not retrieve trips' });
  }
});

app.post('/api/trips', async (req, res) => {
  const { travelerName, destination, tripDate, notes } = req.body;

  if (!travelerName || !destination || !tripDate) {
    return res.status(400).json({ message: 'Traveler name, destination, and date are required.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO trips (traveler_name, destination, trip_date, notes) VALUES (?, ?, ?, ?)',
      [travelerName, destination, tripDate, notes || null]
    );
    res.status(201).json({
      id: result.insertId,
      traveler_name: travelerName,
      destination,
      trip_date: tripDate,
      notes: notes || null,
    });
  } catch (error) {
    console.error('Failed to save trip', error);
    res.status(500).json({ message: 'Could not save trip' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ message: 'Unexpected server error' });
});

ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Vis Trips server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed', error);
    process.exit(1);
  });
