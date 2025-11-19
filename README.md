# Vis Trips

Een kleine full-stack demo die een statische HTML/CSS-frontend combineert met een Express backend en een MySQL database. Via het formulier kun je trips opslaan en direct bekijken.

## Vereisten
- Node.js 18+
- MySQL 8+

## Installatie
1. Installeer dependencies:
   ```bash
   npm install
   ```
2. Maak een `.env` bestand op basis van `.env.example` en vul je MySQL gegevens in:
   ```bash
   cp .env.example .env
   ```
3. Start de server:
   ```bash
   npm start
   ```
4. Open de app op [http://localhost:3000](http://localhost:3000).

> De backend maakt automatisch de tabel `trips` aan als deze nog niet bestaat.

## API
- `GET /api/health` — controleert of de databaseverbinding werkt.
- `GET /api/trips` — haalt alle opgeslagen trips op.
- `POST /api/trips` — slaat een nieuwe trip op. Vereist JSON body:
  ```json
  {
    "travelerName": "Noor",
    "destination": "Oslo",
    "tripDate": "2024-12-01",
    "notes": "Hengels meenemen"
  }
  ```

## Structuur
```
public/        # Statische frontend
server.js      # Express server + MySQL logica
.env.example   # Configuratievoorbeeld
```

## MySQL handmatig voorbereiden (optioneel)
De server maakt de tabel aan, maar je kunt het ook zelf doen:
```sql
CREATE DATABASE vis_trips;
USE vis_trips;
CREATE TABLE trips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  traveler_name VARCHAR(100) NOT NULL,
  destination VARCHAR(150) NOT NULL,
  trip_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
