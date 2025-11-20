# MySQL server configuratie

1. Plaats de bestanden op een server met PHP 8.x en `pdo_mysql` actief. `api.php` handelt de databasecontrole, creatie van de database/gebruiker en het wegschrijven van de dataset af zonder dat je een Node/Express API hoeft te starten.
2. Bij de eerste laadpoging probeert de site automatisch een database `vis_trips` en gebruiker `vis_app` met een willekeurig wachtwoord aan te maken via `root` zonder wachtwoord. Lukt dat niet (bijvoorbeeld omdat de root-login anders is), dan verschijnt het formulier waarin je handmatig host/database/gebruiker/wachtwoord kunt invullen.
3. Open `index.html` vanaf dezelfde host zodat de fetch-calls `api.php?action=…` kunnen bereiken. Staat "Schrijf automatisch weg naar MySQL" aan, dan schrijft de site automatisch naar MySQL en toont de status onderin het scherm.

De backend gebruikt standaard de database `vis_trips`; pas dit aan in `config.json` of in het formulier dat verschijnt wanneer er nog geen configuratie bestaat.
