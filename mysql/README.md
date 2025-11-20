# MySQL server configuratie

1. Maak een kopie van `config.example.json` naar `config.json` en vul host/user/password in (gebruik een account met rechten om nieuwe databases/users te kunnen maken). Laat de database-naam leeg om `vis_trips` te gebruiken.
2. Plaats de bestanden op een server met PHP 8.x en `pdo_mysql` actief. `api.php` handelt de databasecontrole, creatie van de database/gebruiker en het wegschrijven van de dataset af zonder dat je een Node/Express API hoeft te starten.
3. Open `index.html` vanaf dezelfde host zodat de fetch-calls `api.php?action=…` kunnen bereiken. Staat "Schrijf automatisch weg naar MySQL" aan, dan schrijft de site automatisch naar MySQL en toont de status onderin het scherm.

De backend gebruikt standaard de database `vis_trips`; pas dit aan in `config.json` of in het formulier dat verschijnt wanneer er nog geen configuratie bestaat.
