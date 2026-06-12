# Besorgly – Hinweise für Claude Code

## Workflow

- Nach Abschluss einer Änderung IMMER einen neuen Branch von `origin/main`
  erstellen, committen, pushen und einen neuen Pull Request eröffnen.
  Niemals nur auf einen bestehenden (bereits gemergten) Branch pushen.
- Branch-Namen: `claude/<kurze-beschreibung>`.

## Architektur

- Statisches Frontend ohne Build-Schritt: `index.html` + `app.js` + `styles.css`
  (Kundenseite), `admin/` (Admin-Dashboard). Vanilla JS, deutsche UI-Texte.
- Backend: `server/upload_server.py` – Python-Stdlib-HTTP-Server, keine
  Dependencies. Speicherung als JSON-Dateien unter `/var/lib/besorgly/orders/`.
- Ein Reverse-Proxy mappt `/api/*` auf die Server-Pfade (z. B. `/api/orders`
  → `/orders`). Im Code tauchen daher beide Formen auf.
- Cache-Busting über Query-Strings (`app.js?v=...`): bei JS/CSS-Änderungen
  die Versionsangabe in den HTML-Dateien mit anpassen.

## Testen

- Syntax: `node --check app.js admin/admin.js` und
  `python3 -m py_compile server/upload_server.py`.
- Funktional: Server lokal starten
  (`python3 server/upload_server.py --port 18099 --storage /tmp/test-orders
  --admin-password-file /tmp/pw.txt`) und Endpunkte mit `curl` testen.
  Achtung: Geocoding (photon.komoot.io) braucht Netzzugang; Bestellanlage
  per API schlägt offline fehl – Testdaten dann direkt als
  `order.json`-Dateien anlegen.
- Admin-Session-Cookie hat `Path=/api/admin`; beim direkten Testen ohne
  Proxy das Cookie manuell als Header mitgeben.
