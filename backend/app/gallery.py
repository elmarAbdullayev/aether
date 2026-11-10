"""Gallery storage: image files on disk, metadata in SQLite."""

from __future__ import annotations

import base64
import binascii
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MAX_IMAGE_BYTES = 8 * 1024 * 1024
WORLDS = ("hand", "draw", "mirror", "voice")

_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,(.+)$", re.DOTALL)
_SIGNATURES = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpeg": (b"\xff\xd8\xff",),
    "webp": (b"RIFF",),
}
_EXTENSIONS = {"png": "png", "jpeg": "jpg", "webp": "webp"}


class InvalidImage(ValueError):
    """The uploaded image is missing, too big or not a real image."""


@dataclass(frozen=True)
class GalleryItem:
    id: str
    world: str
    created_at: str
    filename: str


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    """Return (kind, bytes) for a base64 image data URL, or raise InvalidImage."""
    match = _DATA_URL.match(data_url.strip())
    if not match:
        raise InvalidImage("Image must be a PNG, JPEG or WebP data URL.")
    kind, payload = match.groups()
    if len(payload) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise InvalidImage("Image is too big (max 8 MB).")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidImage("Image data is not valid base64.") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise InvalidImage("Image is too big (max 8 MB).")
    if not raw.startswith(_SIGNATURES[kind]):
        raise InvalidImage("Image content does not match its type.")
    if kind == "webp" and raw[8:12] != b"WEBP":
        raise InvalidImage("Image content does not match its type.")
    return kind, raw


class Gallery:
    def __init__(self, data_dir: Path) -> None:
        self.images_dir = data_dir / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "gallery.db"
        with self._connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS images (
                    id TEXT PRIMARY KEY,
                    world TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    filename TEXT NOT NULL
                )"""
            )

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        return db

    def add(self, world: str, data_url: str) -> GalleryItem:
        kind, raw = decode_data_url(data_url)
        item_id = uuid.uuid4().hex
        item = GalleryItem(
            id=item_id,
            world=world,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            filename=f"{item_id}.{_EXTENSIONS[kind]}",
        )
        (self.images_dir / item.filename).write_bytes(raw)
        with self._connect() as db:
            db.execute(
                "INSERT INTO images (id, world, created_at, filename) VALUES (?, ?, ?, ?)",
                (item.id, item.world, item.created_at, item.filename),
            )
        return item

    def list(self) -> list[GalleryItem]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT id, world, created_at, filename FROM images ORDER BY created_at DESC, rowid DESC"
            ).fetchall()
        return [GalleryItem(**dict(row)) for row in rows]

    def delete(self, item_id: str) -> bool:
        with self._connect() as db:
            row = db.execute("SELECT filename FROM images WHERE id = ?", (item_id,)).fetchone()
            if row is None:
                return False
            db.execute("DELETE FROM images WHERE id = ?", (item_id,))
        (self.images_dir / row["filename"]).unlink(missing_ok=True)
        return True
