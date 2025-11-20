# Vis Trips

Browsergebaseerde kaart-tool om viswateren, stekken, rigs en dieptepunten te beheren, met directe opslag naar MySQL via de meegeleverde `api.php`.

## Projectstructuur
- `index.html` – hoofdinterface en modals voor databaseconfiguratie.
- `js/app.js` – clientlogica voor kaart, opslag en MySQL-synchronisatie.
- `css/style.css` – styling voor kaart, panelen en dialoogvensters.
- `api.php` – PHP-backend voor status-checks, database/provisioning en data-opslag.
- `mysql/schema.sql` – referentieschema voor de MySQL-tabellen.

## Installatie
1. Zorg dat PHP 8+ met `pdo_mysql` beschikbaar is en dat MySQL draait.
2. Plaats de repo in je webroot of start een PHP server:
   ```bash
   php -S localhost:3000
   ```
   en open `http://localhost:3000/`.

## Database aanmaken
- Bij eerste bezoek controleert de site of MySQL-config aanwezig is.
- Ontbreekt de configuratie of de database? Dan verschijnt een modal.
  - Vul de gewenste host/database/app-gebruiker én een **adminaccount** (bijv. `root`) waarmee de site de database en gebruiker mag aanmaken. Admin-gegevens worden niet opgeslagen.
- Als er geen admin beschikbaar is, kan de backend een automatische poging doen met `root` zonder wachtwoord; lukt dit niet, vraag het admin-account op en vul het in de modal.

## Handmatige opslag of sync uitschakelen
- Gebruik de toggle “Server sync” in de toolbar om automatisch syncen aan/uit te zetten.
- Klik op “Sync nu” om direct naar MySQL te schrijven.

## Tests
- PHP syntax-check:
  ```bash
  php -l api.php
  ```
