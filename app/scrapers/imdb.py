import json
import re
from urllib.parse import quote
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


class IMDBScraper:
    BASE_URL = "https://www.imdb.com"
    CZDB_URL = "https://api.czdb.cz/search"
    HEADERS = {
        "Accept-Language": "cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        ),
    }

    def search_movie(self, query, media_type=None):
        try:
            suggestion = self._search_suggestion(query, media_type)
            if suggestion:
                details = self.get_movie_details(suggestion["imdb_id"])
                if details:
                    return details
                return suggestion

            response = requests.get(
                f"{self.BASE_URL}/find/",
                params={"q": query, "s": "tt"},
                headers=self.HEADERS,
                timeout=10,
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "lxml")

            link = soup.select_one("a[href*='/title/tt']")
            if not link or not link.get("href"):
                return None

            match = re.search(r"/title/(tt\d+)", link["href"])
            if not match:
                return None

            return self.get_movie_details(match.group(1))
        except Exception as exc:
            print(f"IMDB Search Error: {exc}")
            return None

    def _search_suggestion(self, query, media_type=None):
        clean = re.sub(r"\s+", "_", query.strip().lower())
        if not clean:
            return None

        url = f"https://v3.sg.media-imdb.com/suggestion/{quote(clean[0])}/{quote(clean)}.json"
        try:
            response = requests.get(url, headers=self.HEADERS, timeout=10)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            print(f"IMDB Suggestion Error: {exc}")
            return None

        wanted = "TV series" if media_type == "tvshow" else "feature"
        fallback = None
        for item in data.get("d", []):
            imdb_id = item.get("id")
            title = item.get("l")
            if not imdb_id or not title or not imdb_id.startswith("tt"):
                continue

            item_type = item.get("q") or ""
            item_qid = item.get("qid") or ""
            candidate = {
                "source": "imdb",
                "imdb_id": imdb_id,
                "csfd_id": None,
                "title": title,
                "year": item.get("y") or 0,
                "rating": 0.0,
                "poster": item.get("i", {}).get("imageUrl", "") if isinstance(item.get("i"), dict) else "",
                "plot": item_type,
                "genres": [],
                "type": "tvshow" if "TV" in item_type or item_qid == "tvSeries" else "movie",
            }

            if media_type and candidate["type"] == media_type:
                return candidate
            if not media_type and wanted in item_type:
                return candidate
            if fallback is None:
                fallback = candidate

        return fallback

    def get_movie_details(self, imdb_id):
        try:
            response = requests.get(
                f"{self.BASE_URL}/title/{imdb_id}/",
                headers=self.HEADERS,
                timeout=10,
            )
            response.raise_for_status()
            if self._is_waf_challenge(response.text):
                return self._czdb_by_imdb(imdb_id)

            soup = BeautifulSoup(response.content, "lxml")
            data = self._json_ld(soup)

            title = data.get("name") or self._text(soup.select_one("h1"))
            if not title:
                return self._czdb_by_imdb(imdb_id)

            year = self._year(data, soup)
            rating = self._rating(data, soup)
            poster = data.get("image") or ""
            plot = data.get("description") or ""
            genres = data.get("genre") or []
            if isinstance(genres, str):
                genres = [genres]
            media_type = self._media_type(data)

            return {
                "source": "imdb",
                "imdb_id": imdb_id,
                "csfd_id": None,
                "title": title,
                "year": year,
                "rating": rating,
                "poster": poster,
                "plot": plot,
                "genres": genres,
                "type": media_type,
            }
        except Exception as exc:
            print(f"IMDB Detail Error: {exc}")
            return self._czdb_by_imdb(imdb_id)

    def _czdb_by_imdb(self, imdb_id):
        try:
            response = requests.get(self.CZDB_URL, params={"i": imdb_id}, timeout=12)
            response.raise_for_status()
            data = response.json()
            results = data.get("results") if isinstance(data, dict) else []
            if not results:
                return None

            item = self._best_czdb_imdb_result(results, imdb_id)
            title = self._clean_czdb_value(item.get("nazev"))
            original_title = self._clean_czdb_value(item.get("original"))
            if not title:
                return None

            poster = self._clean_czdb_value(item.get("obrazek_url")) or self._clean_czdb_value(item.get("imgo"))
            fanart = self._clean_czdb_value(item.get("backgrop")) or poster
            genres = [
                genre.strip()
                for genre in str(item.get("zanr") or "").split(",")
                if genre.strip() and genre.strip() != "N/A"
            ]
            rating = 0.0
            match = re.search(r"(\d+(?:[.,]\d+)?)", str(item.get("hodnoceni") or ""))
            if match:
                rating = float(match.group(1).replace(",", "."))

            return {
                "source": "imdb",
                "imdb_id": imdb_id,
                "csfd_id": str(item.get("csfd_id")) if item.get("csfd_id") else None,
                "title": title,
                "original_title": original_title,
                "year": self._safe_int(item.get("rok")),
                "rating": rating,
                "poster": poster,
                "fanart": fanart,
                "plot": self._clean_czdb_value(item.get("plot")),
                "genres": genres,
                "type": "tvshow" if self._looks_like_series(item) else "movie",
            }
        except Exception as exc:
            print(f"IMDB CZDB Detail Error: {exc}")
            return None

    def _best_czdb_imdb_result(self, results, imdb_id):
        exact = [item for item in results if str(item.get("imdb_id") or "") == imdb_id]
        candidates = exact or results
        with_plot = [item for item in candidates if self._clean_czdb_value(item.get("plot"))]
        return (with_plot or candidates)[0]

    def _clean_czdb_value(self, value):
        text = str(value or "").strip()
        return "" if text in ("", "@", "0", "N/A", "None") else text

    def _looks_like_series(self, item):
        text = " ".join(
            str(item.get(key) or "")
            for key in ("typ", "nazev", "original", "alt_nazev")
        ).lower()
        return "seri" in text or "series" in text or "tv" in text

    def _safe_int(self, value):
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    def _is_waf_challenge(self, text):
        lower = str(text or "").lower()
        return "awswaf" in lower or "challenge.js" in lower or "captcha" in lower

    def _json_ld(self, soup):
        for node in soup.select("script[type='application/ld+json']"):
            try:
                return json.loads(node.string or "{}")
            except json.JSONDecodeError:
                continue
        return {}

    def _year(self, data, soup):
        date = data.get("datePublished") or ""
        match = re.search(r"\b(19\d{2}|20\d{2})\b", date)
        if match:
            return int(match.group(1))

        text = soup.get_text(" ", strip=True)
        match = re.search(r"\b(19\d{2}|20\d{2})\b", text)
        return int(match.group(1)) if match else 0

    def _rating(self, data, soup):
        rating = data.get("aggregateRating", {}).get("ratingValue")
        if rating is None:
            text = soup.get_text(" ", strip=True)
            match = re.search(r"(\d+(?:\.\d+)?)\s*/\s*10", text)
            rating = match.group(1) if match else None
        try:
            return round(float(rating) * 10, 1)
        except (TypeError, ValueError):
            return 0.0

    def _media_type(self, data):
        value = data.get("@type")
        values = value if isinstance(value, list) else [value]
        return "tvshow" if "TVSeries" in values else "movie"

    def _text(self, node):
        return node.get_text(" ", strip=True) if node else ""
