# MySQL server configuratie

1. Maak een kopie van `config.example.json` naar `config.json` en vul host/user/password in (gebruik een account met rechten om nieuwe databases/users te kunnen maken).
2. Start de API lokaal met `npm install` en `npm start`. Bij de eerste run controleert de server of de database bestaat; zo niet, wordt gevraagd welke gebruiker en welk wachtwoord moeten worden aangemaakt. Vervolgens maakt de server de database, gebruiker en alle tabellen aan op basis van `schema.sql`.
3. Wanneer de optie "Schrijf automatisch weg naar MySQL" in de UI is aangevinkt, wordt de volledige dataset (waters, stekken, rigs en Deeper-bathymetrie) via `POST /api/save` opgeslagen.

De API verwacht standaard database `vis_trips` maar je kunt dit in de config of via `MYSQL_DATABASE` aanpassen.
