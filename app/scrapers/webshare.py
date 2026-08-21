import hashlib
import xml.etree.ElementTree as ET
import uuid

import requests
from passlib.hash import md5_crypt


class WebshareScraper:
    API_URL = "https://webshare.cz/api"

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.token = None
        self.device_uuid = str(uuid.uuid4())

    def _post(self, endpoint, data):
        data = dict(data)
        if self.token:
            data["wst"] = self.token

        headers = {
            "Accept": "text/xml; charset=UTF-8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Kodi StreamCinema Plugin",
        }

        try:
            response = requests.post(
                f"{self.API_URL}{endpoint}",
                data=data,
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
            return ET.fromstring(response.content)
        except Exception as exc:
            print(f"WS Error: {exc}")
            return None

    def _fatal_message(self, root):
        return root.findtext("message") or root.findtext("code") or "unknown error"

    def _is_ok(self, root):
        return root is not None and root.findtext("status") == "OK"

    def login(self):
        if not self.username or not self.password:
            return False

        try:
            salt_resp = self._post("/salt/", {"username_or_email": self.username})
            if salt_resp is None:
                return False
            if salt_resp.findtext("status") != "OK":
                print(f"WS Login Salt Error: {self._fatal_message(salt_resp)}")
                return False

            salt = salt_resp.findtext("salt")
            if not salt:
                print("WS Login Salt Error: missing salt")
                return False

            password_md5 = md5_crypt.using(salt=salt).hash(self.password)
            password_hash = hashlib.sha1(password_md5.encode("utf-8")).hexdigest()
            digest = hashlib.md5(
                f"{self.username}:Webshare:{password_hash}".encode("utf-8")
            ).hexdigest()

            token_resp = self._post(
                "/login/",
                {
                    "username_or_email": self.username,
                    "password": password_hash,
                    "digest": digest,
                    "keep_logged_in": 1,
                },
            )
            if token_resp is None:
                return False
            if token_resp.findtext("status") != "OK":
                print(f"WS Login Error: {self._fatal_message(token_resp)}")
                return False

            token = token_resp.findtext("token")
            if token:
                self.token = token
                return True
        except Exception as exc:
            print(f"WS Login Exception: {exc}")

        return False

    def ensure_token(self):
        if not self.token:
            return self.login()

        root = self._post("/user_data/", {})
        if self._is_ok(root):
            return True

        print(f"WS Token Error: {self._fatal_message(root) if root is not None else 'missing response'}")
        self.token = None
        return self.login()

    def search(self, query):
        if self.username and self.password and not self.token:
            self.login()

        root = self._post(
            "/search/",
            {"what": query, "category": "video", "limit": 20, "offset": 0},
        )
        if root is None:
            return []
        if root.findtext("status") != "OK":
            print(f"WS Search Error: {self._fatal_message(root)}")
            return []

        results = []
        for file_node in root.findall("file"):
            ident = file_node.findtext("ident")
            name = file_node.findtext("name") or ""
            size = file_node.findtext("size") or "0"
            if not ident:
                continue

            results.append(
                {
                    "provider": "webshare",
                    "ident": ident,
                    "name": name,
                    "size": int(size),
                }
            )
        return results

    def get_link(self, ident):
        if not self.ensure_token():
            return None

        for index, download_type in enumerate(("video_stream", "file_download", "")):
            data = {
                "ident": ident,
                "device_uuid": self.device_uuid,
                "device_vendor": "HomeAssistant",
                "device_model": "StreamCinema",
                "force_https": 1,
            }
            if download_type:
                data["download_type"] = download_type

            root = self._post("/file_link/", data)
            if root is None:
                return None

            if self._is_ok(root):
                return root.findtext("link")

            message = self._fatal_message(root)
            print(f"WS Link Error ({download_type or 'default'}): {message}")
            if index == 0:
                self.token = None
                if not self.login():
                    return None

        return None

    def stream_headers(self):
        if self.token:
            return {"Cookie": f"wst={self.token}"}
        return {}
