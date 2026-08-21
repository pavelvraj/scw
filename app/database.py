import sqlite3
import os
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = os.getenv("STREAMCINEMA_DB_PATH", str(DEFAULT_DATA_DIR / "db.sqlite"))


STREAM_COLUMNS = {
    "season": "INTEGER",
    "episode": "INTEGER",
    "status": "TEXT DEFAULT 'active'",
    "format": "TEXT",
    "last_checked_at": "TIMESTAMP",
    "stream_url": "TEXT",
}

MEDIA_COLUMNS = {
    "search_query": "TEXT",
    "episode_metadata": "TEXT",
}

def get_db_connection():
    # Zajistíme existenci složky
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()

    # Tabulka médií (filmy/seriály)
    c.execute('''
        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            type TEXT DEFAULT 'movie',
            title TEXT,
            original_title TEXT,
            year INTEGER,
            genres TEXT,        -- JSON list
            rating REAL,
            plot TEXT,
            poster TEXT,
            fanart TEXT,
            imdb_id TEXT,
            csfd_id TEXT,
            search_query TEXT,
            episode_metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Tabulka streamů (odkazy na soubory)
    c.execute('''
        CREATE TABLE IF NOT EXISTS streams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id TEXT,
            provider TEXT,      -- 'webshare' nebo 'fastshare'
            ident TEXT,         -- ID souboru u providera
            filename TEXT,
            size INTEGER,
            duration INTEGER,
            width INTEGER,
            height INTEGER,
            season INTEGER,
            episode INTEGER,
            status TEXT DEFAULT 'active',
            format TEXT,
            last_checked_at TIMESTAMP,
            audio TEXT,         -- JSON
            subtitles TEXT,     -- JSON
            FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
        )
    ''')

    existing_columns = {
        row["name"] for row in c.execute("PRAGMA table_info(streams)").fetchall()
    }
    for column, definition in STREAM_COLUMNS.items():
        if column not in existing_columns:
            c.execute(f"ALTER TABLE streams ADD COLUMN {column} {definition}")

    existing_media_columns = {
        row["name"] for row in c.execute("PRAGMA table_info(media)").fetchall()
    }
    for column, definition in MEDIA_COLUMNS.items():
        if column not in existing_media_columns:
            c.execute(f"ALTER TABLE media ADD COLUMN {column} {definition}")

    conn.commit()
    conn.close()
