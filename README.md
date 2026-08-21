# Stream Cinema Web

Webová aplikace pro vyhledávání, ukládání a přehrávání filmů a seriálů ze služeb Webshare a Fastshare. Aplikace používá lokální SQLite databázi a jednoduché webové rozhraní v češtině.

Aktuální verze: **0.1.0**

## Funkce

- vyhledávání filmů a seriálů na Webshare a Fastshare,
- metadata z ČSFD/IMDb včetně plakátu, hodnocení, žánrů a popisu,
- rozpoznání sezón a epizod ze jmen souborů,
- ukládání vybraných streamů do lokální sbírky,
- HTML5 přehrávání přes aplikační proxy,
- stahování streamů,
- aktualizace sbírky a kontrola nefunkčních streamů,
- úprava názvu, typu, žánrů, plakátu, popisu a vyhledávacího dotazu,
- export a import celé databáze do JSON,
- lokální uložení přihlašovacích údajů v `data/options.json`.

## Docker nasazení přes HTTP

Konfigurace je připravená pro domácí síť za routerem. Veřejný i Docker port jsou **8765**; HTTPS, Let's Encrypt ani porty 80/443 nejsou potřeba.

1. Zkopíruj `.env.example` do `.env` a nastav svou Dynu/DNS doménu.
2. Na routeru vytvoř přesměrování:

   ```text
   TCP veřejný port 8765 -> TCP 8765 na vnitřní IP počítače s Dockerem
   ```

3. Spusť aplikaci:

   ```powershell
   docker compose up -d --build
   ```

4. Otevři:

   ```text
   http://tvoje-domena:8765
   ```

Caddy poslouchá uvnitř kontejneru na portu 8765 a předává požadavky službě `streamcinema` na jejím interním portu 8765. Caddy je záměrně nastavený pouze na HTTP.

## Kontrola provozu

Stav kontejnerů:

```powershell
docker compose ps
```

Kontrola aplikace z hostitele:

```powershell
curl.exe -H "Host: tvoje-domena" http://127.0.0.1:8765/api/ping
```

Očekávaná odpověď:

```json
{"status":"ok","message":"pong"}
```

Logy:

```powershell
docker compose logs -f caddy streamcinema
```

Test z internetu prováděj ideálně z mobilních dat. Některé routery nepodporují NAT loopback, takže veřejná doména nemusí fungovat z vlastní Wi-Fi, i když je přesměrování správně nastavené.

## Nastavení účtů

V záložce **Nastavení** zadej alespoň jeden účet:

- Webshare uživatelské jméno a heslo, nebo
- Fastshare uživatelské jméno a heslo.

Hesla se ukládají pouze lokálně do `data/options.json`. Prázdné heslo při ukládání ponechá již uložené heslo. Volitelná URL ČSFD/CZDB služby slouží pro doplnění metadat; bez ní aplikace používá vestavěný fallback přes ČSFD/IMDb.

## Data a záloha

Persistentní data jsou v adresáři `data`:

- `data/db.sqlite` – databáze sbírky,
- `data/options.json` – nastavení účtů a aplikace.

Před zálohou zastav aplikaci a zkopíruj celý adresář `data`:

```powershell
docker compose stop
Copy-Item -Recurse data data-backup
docker compose start
```

Tyto soubory se neposílají do GitHubu. `.env` je také ignorovaný, aby se do repozitáře nedostala hesla nebo tokeny.

## Lokální spuštění bez Dockeru

Na Windows lze použít `start.bat`. Skript vytvoří virtuální prostředí v `C:\Temp\SCW`, nainstaluje závislosti a spustí aplikaci na `http://127.0.0.1:8765`.

## Verze

Verze je vedena v souboru `VERSION` a odpovídá verzím Git tagů ve formátu `vX.Y.Z` podle Semantic Versioning. Historie změn je v [CHANGELOG.md](CHANGELOG.md).

## Licence

Licence zatím není deklarována. Používej pouze vlastní přístupové údaje a respektuj podmínky služeb, ze kterých aplikace načítá data.
