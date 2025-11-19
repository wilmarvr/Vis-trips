# Vis Trips

Een compacte webapp waarmee je trips kunt opslaan en bekijken in een MySQL database. De frontend is plain HTML/CSS/JS en de backend is een enkel PHP-script, dus je kunt het zo op shared hosting of een lokale XAMPP-stack zetten.

## Vereisten
- PHP 8+
- MySQL 5.7+ (of compatibel)
- Een webserver (Apache/Nginx) of XAMPP/WAMP/LAMP

## Installatie (hosting of XAMPP)
1. Maak een database aan (bijv. `vis_trips`).
2. Kopieer de map `public/` naar de webroot van je hosting of naar de `htdocs` van XAMPP.
3. Configureer databasegegevens:
   - Standaard leest `public/api.php` omgevingsvariabelen `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
   - Kun je geen variabelen zetten? Kopieer `public/config.sample.php` naar `public/config.php` en vul daar je gegevens in.
4. Bezoek de site (bijv. `http://localhost/vis-trips`) en sla je eerste trip op. De tabel wordt automatisch aangemaakt.

## API
- `GET public/api.php` — haalt alle opgeslagen trips op.
- `POST public/api.php` — slaat een nieuwe trip op. Vereist JSON body:
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
public/                # Frontend + PHP API
  ├─ api.php           # Backend eindpunt
  └─ config.sample.php # Optioneel: kopieer naar config.php voor DB-gegevens
.env.example           # Voorbeeld van DB variabelen (voor hosting die env vars ondersteunt)
```

## MySQL handmatig voorbereiden (optioneel)
De PHP backend maakt de tabel aan, maar je kunt het ook zelf doen:
```
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
