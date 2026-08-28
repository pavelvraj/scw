# Stream Cinema Web

Webová aplikace pro vyhledávání, ukládání a přehrávání filmů a seriálů ze služeb Webshare a Fastshare. Aplikace používá lokální SQLite databázi a jednoduché webové rozhraní v češtině.

Aktuální verze: **0.3.1**

## Funkce

- vyhledávání filmů a seriálů na Webshare a Fastshare,
- metadata z ČSFD/IMDb včetně plakátu, hodnocení, žánrů a popisu,
- rozpoznání sezón a epizod ze jmen souborů,
- ukládání vybraných streamů do lokální sbírky,
- HTML5 přehrávání přímým odkazem Webshare, pokud ho služba poskytne,
- serverová proxy pro Fastshare, která bezpečně přidává cookie potřebnou pro stream,
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

### Docker Engine uvnitř WSL2

Updater automaticky rozpozná Docker Engine dostupný přes WSL2. Pro distribuci Ubuntu 24.04 lze aktualizaci spustit například takto:

```powershell
.\UPDATE.ps1 -Version v0.3.1 -WslDistro Ubuntu-24.04
```

Updater používá linuxovou cestu `/mnt/c/Temp/SCW`, takže Compose správně najde `docker-compose.yml`, `.env`, `Caddyfile` i adresář `data`.

Ruční spuštění Compose z Windows PowerShellu přes WSL:

```powershell
wsl -d Ubuntu-24.04 -u root -- docker compose --project-directory /mnt/c/Temp/SCW --env-file /mnt/c/Temp/SCW/.env -f /mnt/c/Temp/SCW/docker-compose.yml up -d --build
```

Pokud WSL používá výchozí NAT networking, spusť po aktualizaci v PowerShellu jako správce:

```powershell
.\Configure-WslPortProxy.ps1 -Distro Ubuntu-24.04 -Port 8765
```

Skript přesměruje Windows TCP port 8765 na aktuální IP adresu WSL a povolí port ve Windows Firewallu. Router nadále směruje veřejný port 8765 na Windows IP počítače. IP adresa WSL se po restartu může změnit, proto skript po restartu WSL případně spusť znovu. Při použití WSL mirrored networking režimu portproxy obvykle není potřeba.

## Přehrávání a rychlost

Při přehrávání aplikace nejdříve získá od poskytovatele odkaz na soubor. Webshare vrací odkaz, který lze předat přímo Kodi, takže video neteče přes domácí server. Fastshare v současné době vyžaduje cookie `FASTSHARE` i při použití přímého `download.php` odkazu. Fastshare proto zůstává přes aplikační proxy; cookie i přihlašovací údaje zůstávají pouze v Dockeru a do Kodi se neposílají.

Proxy zachovává HTTP Range hlavičky, takže Kodi může video bufferovat a přetáčet. Pokud Fastshare v budoucnu začne poskytovat odkaz použitelný bez cookie, bude možné jeho přímé předávání znovu ověřit a zapnout.

## Kontrola provozu

Stav kontejnerů:

```powershell
docker compose ps
```

Pokud Docker běží pouze ve WSL2, použij:

```powershell
wsl -d Ubuntu-24.04 -u root -- docker compose --project-directory /mnt/c/Temp/SCW --env-file /mnt/c/Temp/SCW/.env -f /mnt/c/Temp/SCW/docker-compose.yml ps
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

## Aktualizace pomocí UPDATE.ps1

Soubor `UPDATE.ps1` je určený pro cílový Windows počítač, kde je Docker směrovaný do `C:\Temp\SCW`. Skript umí pracovat i s již existujícím adresářem, který obsahuje pouze `data`, a nevytváří vnořený klon repozitáře.

Spuštění konkrétní verze:

```powershell
Set-Location C:\Temp\SCW
.\UPDATE.ps1 -Version v0.3.1 -WslDistro Ubuntu-24.04
```

Skript zachová `.env` a `data`, stáhne zdrojové soubory z GitHubu a znovu sestaví kontejnery přes Docker Compose. Podporuje Windows Docker engine i Docker engine uvnitř WSL2; při vypnutém Dockeru aktualizuje zdrojové soubory i tak a pouze vypíše příkaz ke spuštění po startu Dockeru.

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

Projekt je zveřejněný pod licencí **GNU GPL v3**; úplné znění je v souboru [LICENSE](LICENSE). Používej pouze vlastní přístupové údaje a respektuj podmínky služeb, ze kterých aplikace načítá data.
