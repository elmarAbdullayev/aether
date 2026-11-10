"""Gallery storage: image files on disk, metadata in SQLite."""

from __future__ import annotations

import base64
import binascii
import json
import re
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_IMAGE_BYTES = 8 * 1024 * 1024
WORLDS = ("hand", "draw", "mirror", "voice")

_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,(.+)$", re.DOTALL)
_SIGNATURES = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpeg": (b"\xff\xd8\xff",),
    "webp": (b"RIFF",),
}
_EXTENSIONS = {"png": "png", "jpeg": "jpg", "webp": "webp"}


MAX_VIDEO_BYTES = 40 * 1024 * 1024
_VIDEO_DATA_URL = re.compile(r"^data:video/(webm|mp4);base64,(.+)$", re.DOTALL)


class InvalidImage(ValueError):
    """The uploaded image or video is missing, too big or not what it claims to be."""


@dataclass(frozen=True)
class GalleryItem:
    id: str
    world: str
    created_at: str
    filename: str
    has_sculpture: bool = False
    video_filename: str | None = None


def decode_video_data_url(data_url: str) -> tuple[str, bytes]:
    """Return (extension, bytes) for a base64 WebM or MP4 data URL, or raise InvalidImage."""
    match = _VIDEO_DATA_URL.match(data_url.strip())
    if not match:
        raise InvalidImage("Video must be a WebM or MP4 data URL.")
    kind, payload = match.groups()
    if len(payload) > MAX_VIDEO_BYTES * 4 // 3 + 4:
        raise InvalidImage("Video is too big (max 40 MB).")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidImage("Video data is not valid base64.") from exc
    # WebM starts with the EBML header, MP4 has "ftyp" after the first box size
    valid = raw.startswith(b"\x1a\x45\xdf\xa3") if kind == "webm" else raw[4:8] == b"ftyp"
    if not valid:
        raise InvalidImage("Video content does not match its type.")
    return kind, raw


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
                    filename TEXT NOT NULL,
                    sculpture TEXT,
                    video TEXT
                )"""
            )
            # older galleries miss the columns added later (sculpture: world 2, video: world 3)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(images)")}
            for column in ("sculpture", "video"):
                if column not in columns:
                    db.execute(f"ALTER TABLE images ADD COLUMN {column} TEXT")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        try:
            with db:  # commits, or rolls back on error
                yield db
        finally:
            db.close()

    def add(
        self,
        world: str,
        data_url: str,
        sculpture: dict[str, Any] | None = None,
        video_data_url: str | None = None,
    ) -> GalleryItem:
        """Saves a picture, optionally with a 3D sculpture or a video clip (the picture is its preview)."""
        kind, raw = decode_data_url(data_url)
        video = decode_video_data_url(video_data_url) if video_data_url else None
        item_id = uuid.uuid4().hex
        item = GalleryItem(
            id=item_id,
            world=world,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            filename=f"{item_id}.{_EXTENSIONS[kind]}",
            has_sculpture=sculpture is not None,
            video_filename=f"{item_id}.{video[0]}" if video else None,
        )
        (self.images_dir / item.filename).write_bytes(raw)
        if video and item.video_filename:
            (self.images_dir / item.video_filename).write_bytes(video[1])
        with self._connect() as db:
            db.execute(
                "INSERT INTO images (id, world, created_at, filename, sculpture, video) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    item.id,
                    item.world,
                    item.created_at,
                    item.filename,
                    json.dumps(sculpture, separators=(",", ":")) if sculpture is not None else None,
                    item.video_filename,
                ),
            )
        return item

    def list(self) -> list[GalleryItem]:
        with self._connect() as db:
            rows = db.execute(
                """SELECT id, world, created_at, filename, sculpture IS NOT NULL AS has_sculpture, video
                   FROM images ORDER BY created_at DESC, rowid DESC"""
            ).fetchall()
        return [
            GalleryItem(
                id=row["id"],
                world=row["world"],
                created_at=row["created_at"],
                filename=row["filename"],
                has_sculpture=bool(row["has_sculpture"]),
                video_filename=row["video"],
            )
            for row in rows
        ]

    def sculpture(self, item_id: str) -> dict[str, Any] | None:
        """The 3D drawing saved with a picture, or None."""
        with self._connect() as db:
            row = db.execute("SELECT sculpture FROM images WHERE id = ?", (item_id,)).fetchone()
        if row is None or row["sculpture"] is None:
            return None
        return json.loads(row["sculpture"])

    def delete(self, item_id: str) -> bool:
        with self._connect() as db:
            row = db.execute("SELECT filename, video FROM images WHERE id = ?", (item_id,)).fetchone()
            if row is None:
                return False
            db.execute("DELETE FROM images WHERE id = ?", (item_id,))
        (self.images_dir / row["filename"]).unlink(missing_ok=True)
        if row["video"]:
            (self.images_dir / row["video"]).unlink(missing_ok=True)
        return True
