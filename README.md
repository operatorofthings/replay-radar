# Replay Radar

Finde neue Gründe, deine Steam-Spiele wieder anzuspielen – und ein gemeinsames Koop-Spiel für den nächsten Abend.

**Live: [replay-radar.com](https://replay-radar.com)**

## Features

- Offizielle Entwickler-News seit deinem letzten Spielzeitpunkt, gewichtet nach Vollversion, DLC und Updates.
- Genre-Filter und erklärbare Scores: wichtigstes Ereignis plus begrenzte Boni für weitere Inhalte, Aktualität und Abwechslung.
- „Keine Lust“ (7 Tage), kompakte Wiedervorlage (1/3/7 Tage), Sofort-bis-morgen und Rückgängig.
- Koop-Rad aus beiden Bibliotheken, optionale Score-Gewichtung, durchsuchbare Liste mit Gewinnchancen und getrennten Koop-Ausblendungen.
- Einführung mit Quellcode, Architektur und Datenvorhaltung beim ersten Besuch; später unter „So funktioniert’s“.
- Steam OpenID: Das Passwort bleibt bei Steam. Anmeldung ist für alle Steam-Konten offen.

## Lokal starten

Node.js 22 oder neuer:

```bash
npm ci
cp .env.example .env
# STEAM_API_KEY in .env setzen; nicht veröffentlichen.
npm run dev
```

Öffne http://localhost:4317. Ohne Anmeldung zeigt die App klar markierte Beispieldaten. Eigene Spieledetails, Freundesliste und Spieledetails des Freundes müssen über Steam abrufbar sein. OpenID hebt private Steam-Einstellungen nicht auf.

Für den Produktionsmodus: `npm run build && npm start`. Die lokale `.runtime` ist optional und wird nicht mitgeliefert.

## Wie der Score funktioniert

Standard: Vollversion **100**, neuer DLC **70**, großes Update **40**, Content-Update **15**. Das wichtigste Ereignis zählt voll. Weitere Inhalte liefern einen allmählich sättigenden Bonus unter 6 Punkten; Aktualität bis 4; Abwechslung bis 3. Anzeige mit einer Nachkommastelle statt einer schnellen Sättigung auf demselben ganzzahligen Wert. Gleiche Werte bleiben möglich und werden stabil nach AppID sortiert.

Der Abwechslungsbonus verwendet verfügbare Spielminuten der letzten 14 Tage und deren Store-Genres. Häufig gespielte Genres bekommen weniger Bonus. Ohne Daten kein Bonus; während eines Scans kann er sich mit weiteren Metadaten verändern. In der Demo wird das ausdrücklich beispielhaft berechnet. Der Score ist eine Rückkehrhilfe, kein Qualitätsurteil. Hover, Tastatur oder Tippen auf den Score zeigt die Bestandteile.

Überschriften werden heuristisch eingeordnet; Sales, Zukunftsankündigungen und Hotfixes werden soweit erkennbar ausgeschlossen. Pro Spiel maximal 500 Meldungen. Fehler und unvollständige Archive werden angezeigt. DLC-Besitz wird nicht überprüft. Ohne letzten Spielzeitpunkt wird kein Rückkehrvergleich erfunden.

Koop braucht gemeinsame AppIDs und Steam-Kategorie 38 (Online-Koop), optional 9/39. Standardmäßig gleiche Chancen. Optional: `Gewicht = 1 + Replay-Score / 50`. Unbewertete Spiele behalten Gewicht 1. Auswahl, Prozentanzeige und Rad verwenden dieselben Intervalle; die Zufallsquelle ist `crypto.getRandomValues`. Bei über 20 Kandidaten zeigt das Rad nur Segmente und Tooltips; die durchsuchbare Liste enthält weiterhin sämtliche Titel. Koop-Scores übernehmen vorhandene Radar-Ergebnisse und lösen keinen zusätzlichen News-Scan aus.

## Daten und Hosting

CloudFront/WAF → privates S3 für die Oberfläche, Lambda für API und Login, SQS/Lambda für Scans, DynamoDB mit Ablaufzeiten. Terraform verwaltet Infrastruktur einschließlich Route 53 und ACM. GitHub Actions veröffentlicht App-Versionen per kurzlebigem AWS-OIDC-Login.

Details zu Kosten, Aufbewahrung, Deployment und Betrieb: **[docs/AWS.md](docs/AWS.md)**.

## Tests

```bash
npm test
npm run build
npm run build:aws
npx playwright install --with-deps chromium
npm run test:ui
```

Playwright startet den lokalen Server bei Bedarf. Tests prüfen Ranking, gewichtete Auswahl, Ablaufzeiten, Isolation, Queue-Wiederaufnahme, Authentifizierung, Ausblendungen, Einführung und große Koop-Bibliotheken. Ein vollständiger persönlicher Steam-Login ist interaktiv.

Optional registriert die Oberfläche einen Genre-Filter für Browser mit WebMCP-Unterstützung.

Quellen: [Steam OpenID](https://steamcommunity.com/dev), [IPlayerService](https://partner.steamgames.com/doc/webapi/IPlayerService), [ISteamUser](https://partner.steamgames.com/doc/webapi/ISteamUser), [ISteamNews](https://partner.steamgames.com/doc/webapi/ISteamNews).
