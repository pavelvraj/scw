# Changelog

Všechny významné změny tohoto projektu jsou zapisovány v tomto souboru.

## [0.1.1] - 2026-08-21

### Opraveno

- `UPDATE.ps1` nyní aktualizuje i existující instalaci se starými zdrojovými soubory,
- staré zdrojové soubory se před aktualizací přesunou do záložního adresáře,
- `data`, `.env` a případné `certs` zůstávají zachované,
- chybějící Git tag se nyní oznámí s přehledem dostupných verzí,
- výstup PowerShell updateru je kompatibilní se starším kódováním konzole.

## [0.1.0] - 2026-08-21

### Přidáno

- první verzovaná Docker distribuce Stream Cinema Web,
- webové rozhraní pro filmy, seriály, streamy a lokální sbírku,
- integrace Webshare a Fastshare,
- metadata z ČSFD/IMDb,
- HTML5 přehrávání, stahování a lokální stream proxy,
- import a export databáze,
- česká dokumentace pro provoz za domácím routerem.
- PowerShell updater pro instalaci do existujícího adresáře `C:\Temp\SCW`.

### Opraveno

- HTTP proxy nyní skutečně poslouchá na portu 8765,
- odstraněno nechtěné automatické HTTPS a pokusy o Let's Encrypt,
- veřejný port a interní port aplikace už nejsou zaměňovány přes `HTTPS_PORT`,
- povolené Host hlavičky se konfigurují podle domény z `.env`.

### Bezpečnost

- `.env`, hesla, tokeny a lokální SQLite data jsou v `.gitignore`,
- Caddy ukládá svou konfiguraci do pojmenovaných Docker volume.
