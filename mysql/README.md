# MySQL server configuratie

1. Maak een kopie van `config.example.json` naar `config.json` en vul host/user/password in.
2. Draai het schema uit `schema.sql` om de tabellen aan te maken (`mysql < schema.sql`).
3. Start de API lokaal met `npm install` en `npm start`.
4. Wanneer de optie "Schrijf automatisch weg naar MySQL" in de UI is aangevinkt, wordt de volledige dataset (waters, stekken, rigs en Deeper-bathymetrie) via `POST /api/save` opgeslagen.

De API verwacht standaard database `vis_trips` maar je kunt dit in de config of via `MYSQL_DATABASE` aanpassen.
