import base64
import re
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup


class FastshareScraper:
    API_URLS = [
        "https://fastshare.cz/api/api_kodi.php",
        "https://fastshare.cloud/api/api_kodi.php",
        "https://fastshare.cloud/api/api_json2.php",
        "https://fastshare.cz/api/api_json2.php",
    ]
    BASE_URLS = [
        "https://fastshare.cloud",
        "https://www.fastshare.cz",
    ]
    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        )
    }

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        self.logged_in = False
        self.hash = ""

    def login(self):
        if not self.username or not self.password:
            return False

        try:
            response = self.session.get(
                "https://fastshare.cz/api/api_kodi.php",
                params={
                    "process": "login",
                    "login": self.username,
                    "password": self.password,
                },
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            user_hash = ((data.get("user") or {}).get("hash") or "").strip()
            if user_hash:
                self.hash = user_hash
                self.session.cookies.set("FASTSHARE", user_hash, domain=".fastshare.cz")
                self.session.cookies.set("FASTSHARE", user_hash, domain=".fastshare.cloud")
                self.logged_in = True
                return True
        except Exception as exc:
            print(f"FS API Login Error: {exc}")

        for base_url in self.BASE_URLS:
            try:
                response = self.session.post(
                    f"{base_url}/login",
                    data={
                        "login_name": self.username,
                        "login_password": self.password,
                        "permanent": 1,
                    },
                    timeout=10,
                )
                response.raise_for_status()
                text = response.text.lower()
                if "logout" in text or "odhl" in text:
                    self.logged_in = True
                    return True
            except Exception as exc:
                print(f"FS Login Error ({base_url}): {exc}")

        return False

    def search(self, query):
        if self.username and self.password and not self.logged_in:
            self.login()

        seen = set()
        merged = []
        for search_method in (self._search_api, self._search_ajax, self._search_web):
            for search_query in self._query_variants(query):
                for item in search_method(search_query):
                    if item["ident"] in seen:
                        continue
                    merged.append(item)
                    seen.add(item["ident"])

        return merged

    def _query_variants(self, query):
        cleaned = re.sub(r"\s+", " ", query.strip())
        variants = [cleaned]
        words = [word for word in re.split(r"\s+", cleaned) if len(word) >= 4]
        if len(words) > 1:
            variants.append(words[-1])
            variants.extend(words)
        return list(dict.fromkeys(variants))

    def _search_ajax(self, query):
        results = []
        seen = set()
        encoded = base64.b64encode(query.lower().encode("utf-8")).decode("ascii")

        for base_url in self.BASE_URLS:
            referer = f"{base_url}/{quote(query.lower().replace(' ', '-'))}/s"
            for limit in (1, 33, 65):
                params = {
                    "token": "streamcinema",
                    "u": "",
                    "search_purpose": 0,
                    "search_resolution": 0,
                    "order": "",
                    "type": "video",
                    "term": encoded,
                    "plain_search": 0,
                    "limit": limit,
                    "step": 32,
                }
                try:
                    response = self.session.get(
                        f"{base_url}/test2.php",
                        params=params,
                        headers={"Referer": referer},
                        timeout=10,
                    )
                    response.raise_for_status()
                    page_results = self._parse_ajax_html(response.text)
                    if not page_results:
                        break
                    for item in page_results:
                        if item["ident"] in seen:
                            continue
                        results.append(item)
                        seen.add(item["ident"])
                except Exception as exc:
                    print(f"FS AJAX Search Error ({base_url}): {exc}")
                    break
            if results:
                return results

        return results

    def _search_api(self, query):
        results = []
        seen = set()
        last_error = None
        for api_url in self.API_URLS:
            params_candidates = [
                # Official Kodi addon request shape.
                {"process": "search", "pagination": 200, "term": query, "adult": 0},
                # Backward-compatible mobile/api_json2 variant.
                {"process": "search", "term": query, "page": 1},
            ]
            for params in params_candidates:
                try:
                    response = self.session.get(api_url, params=params, timeout=10)
                    response.raise_for_status()
                    page_results = self._parse_api_response(response.json())
                    for item in page_results:
                        if item["ident"] in seen:
                            continue
                        results.append(item)
                        seen.add(item["ident"])
                    if page_results:
                        break
                except Exception as exc:
                    last_error = exc
                    break
            if results:
                return results

        if results:
            return results

        if last_error:
            print(f"FS API Search Error: {last_error}")
        return []

    def _parse_api_response(self, data):
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = (
                data.get("files")
                or data.get("file")
                or data.get("data")
                or data.get("items")
                or data.get("results")
                or data.get("list")
                or []
            )
            search = data.get("search")
            if not items and isinstance(search, dict):
                items = search.get("file") or search.get("files") or []
            if isinstance(items, dict):
                items = list(items.values())
        else:
            items = []

        if not items:
            if isinstance(data, dict) and isinstance(data.get("search"), dict):
                total = data["search"].get("total")
                if str(total) == "0":
                    return []
            preview = str(data)
            print(f"FS API Search Debug: unrecognized response {preview[:500]}")

        results = []
        for item in items:
            if not isinstance(item, dict):
                continue

            ident = (
                item.get("id")
                or item.get("file_id")
                or item.get("ident")
                or item.get("u")
            )
            name = (
                item.get("name")
                or item.get("filename")
                or item.get("file_name")
                or item.get("title")
                or item.get("n")
            )
            size = (
                item.get("size_bytes")
                or item.get("size")
                or item.get("filesize")
                or item.get("bytes")
                or item.get("s")
                or self._nested_value(item.get("data"))
                or 0
            )
            duration = (
                item.get("duration_seconds")
                or item.get("duration")
                or item.get("length")
                or self._nested_value(item.get("duration"))
            )
            if not ident or not name:
                continue

            results.append(
                {
                    "provider": "fastshare",
                    "ident": str(ident),
                    "name": str(name),
                    "size": self._parse_size(size),
                    "duration": self._parse_int(duration),
                    "stream_url": item.get("download_url") or item.get("url") or item.get("link") or "",
                }
            )

        return results

    def _search_web(self, query):
        urls = []
        for base_url in self.BASE_URLS:
            urls.extend([
                f"{base_url}/{quote(query)}/s",
                f"{base_url}/video/s",
                f"{base_url}/videa/s",
            ])
        params_list = [
            {"type": "video"},
            {"term": query, "type": "video"},
        ]

        for url in urls:
            for params in params_list:
                try:
                    response = self.session.get(url, params=params, timeout=10)
                    response.raise_for_status()
                    results = self._parse_search_html(response.text)
                    if results:
                        return results
                except Exception as exc:
                    print(f"FS Web Search Error: {exc}")

        return []

    def _parse_search_html(self, html):
        soup = BeautifulSoup(html, "lxml")
        results = []
        seen = set()

        for link in soup.select("a[href]"):
            href = link.get("href") or ""
            absolute_url = urljoin(self.BASE_URLS[0], href)
            parsed = urlparse(absolute_url)
            if "fastshare.cz" not in parsed.netloc and "fastshare.cloud" not in parsed.netloc:
                continue

            ident = self._ident_from_url(absolute_url)
            if not ident or ident in seen:
                continue

            name = link.get_text(" ", strip=True) or link.get("title") or ""
            if not self._looks_like_media(name):
                continue

            container_text = link.parent.get_text(" ", strip=True) if link.parent else name
            results.append(
                {
                    "provider": "fastshare",
                    "ident": ident,
                    "name": name,
                    "size": self._parse_size(container_text),
                    "stream_url": "",
                }
            )
            seen.add(ident)

        return results[:20]

    def _parse_ajax_html(self, html):
        soup = BeautifulSoup(html, "lxml")
        results = []
        seen = set()

        for item in soup.select("li.search_item"):
            link = item.select_one(".video_detail p a[href]") or item.select_one("a[href*='fastshare']")
            if not link:
                continue

            href = link.get("href") or ""
            ident = self._ident_from_url(href)
            if not ident or ident in seen:
                continue

            name = link.get_text(" ", strip=True)
            if not name:
                name = href.rsplit("/", 1)[-1].replace("-", " ")

            detail_text = item.get_text(" ", strip=True)
            resolution = re.search(r"(\d{3,4})\s*x\s*(\d{3,4})", detail_text, re.I)
            duration = re.search(r"(\d{1,2}):(\d{2}):(\d{2})", detail_text)

            result = {
                "provider": "fastshare",
                "ident": ident,
                "name": name,
                "size": self._parse_size(detail_text),
                "stream_url": "",
            }
            if resolution:
                result["width"] = int(resolution.group(1))
                result["height"] = int(resolution.group(2))
            if duration:
                result["duration"] = (
                    int(duration.group(1)) * 3600
                    + int(duration.group(2)) * 60
                    + int(duration.group(3))
                )

            results.append(result)
            seen.add(ident)

        return results

    def _ident_from_url(self, url):
        patterns = [
            r"[?&]id=(\d+)",
            r"/file/(\d+)",
            r"fastshare\.(?:cloud|cz)/(\d+)/",
            r"/(\d+)[-/]",
            r"/download/(\d+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def _looks_like_media(self, name):
        lower = name.lower()
        extensions = (".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v")
        return any(ext in lower for ext in extensions)

    def _parse_size(self, value):
        value = self._nested_value(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)

        text = str(value).strip().replace(",", ".")
        if re.fullmatch(r"\d+(?:\.\d+)?", text):
            return int(float(text))

        match = re.search(r"(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb|b)", text, re.I)
        if not match:
            return 0

        amount = float(match.group(1))
        unit = match.group(2).lower()
        multipliers = {
            "b": 1,
            "kb": 1024,
            "mb": 1024**2,
            "gb": 1024**3,
            "tb": 1024**4,
        }
        return int(amount * multipliers[unit])

    def _nested_value(self, value):
        if isinstance(value, dict):
            return value.get("value") or value.get("size") or value.get("bytes")
        return value

    def _parse_int(self, value):
        value = self._nested_value(value)
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def get_link(self, ident):
        if not self.logged_in and not self.login():
            return f"https://fastshare.cloud/free/?lang=cs&u={ident}"

        try:
            response = self.session.get(
                self.API_URLS[0],
                params={"process": "download_file", "file_id": ident},
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("link") or data.get("url") or data.get("download_url")
        except Exception as exc:
            print(f"FS Link Error: {exc}")
            return f"https://fastshare.cloud/free/?lang=cs&u={ident}"

    def stream_headers(self):
        if self.hash:
            return {"Cookie": f"FASTSHARE={self.hash}"}
        return {}
