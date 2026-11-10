"""Aether backend: gallery API, saved images and (after a build) the website itself."""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator

from .gallery import Gallery, GalleryItem, InvalidImage

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_SITE_DIR = BACKEND_DIR.parent / "frontend" / "dist"
MAX_SCULPTURE_POINTS = 60_000

World = Literal["hand", "draw", "mirror", "voice"]


class Stroke(BaseModel):
    color: Literal["rainbow", "red", "blue", "green", "gold"]
    points: list[float] = Field(
        min_length=6,
        max_length=MAX_SCULPTURE_POINTS * 3,
        description="x, y, z, x, y, z, ... in sculpture space",
    )

    @field_validator("points")
    @classmethod
    def check_points(cls, points: list[float]) -> list[float]:
        if len(points) % 3:
            raise ValueError("points must come in groups of three (x, y, z)")
        if not all(math.isfinite(v) and abs(v) < 100 for v in points):
            raise ValueError("points must be finite numbers between -100 and 100")
        return points


class Sculpture(BaseModel):
    """A drawing from the Air Drawing world: glowing strokes in 3D."""

    version: Literal[1] = 1
    strokes: list[Stroke] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def check_size(self) -> "Sculpture":
        if sum(len(s.points) for s in self.strokes) > MAX_SCULPTURE_POINTS * 3:
            raise ValueError(f"a sculpture can have at most {MAX_SCULPTURE_POINTS} points")
        return self


class SaveImage(BaseModel):
    world: World
    image: str = Field(description="Base64 data URL of a PNG, JPEG or WebP image (the preview of a video)")
    sculpture: Sculpture | None = None
    video: str | None = Field(default=None, description="Base64 data URL of a short WebM or MP4 clip")


class ImageOut(BaseModel):
    id: str
    world: str
    created_at: str
    url: str
    has_sculpture: bool
    video_url: str | None


def _out(item: GalleryItem) -> ImageOut:
    return ImageOut(
        id=item.id,
        world=item.world,
        created_at=item.created_at,
        url=f"/images/{item.filename}",
        has_sculpture=item.has_sculpture,
        video_url=f"/images/{item.video_filename}" if item.video_filename else None,
    )


def create_app(data_dir: Path | None = None, site_dir: Path | None = None) -> FastAPI:
    data_dir = data_dir or Path(os.environ.get("AETHER_DATA_DIR", DEFAULT_DATA_DIR))
    site_dir = site_dir or DEFAULT_SITE_DIR
    gallery = Gallery(data_dir)

    app = FastAPI(title="Aether API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/gallery", response_model=list[ImageOut])
    def list_images() -> list[ImageOut]:
        return [_out(item) for item in gallery.list()]

    @app.post("/api/gallery", response_model=ImageOut, status_code=201)
    def save_image(body: SaveImage) -> ImageOut:
        sculpture = body.sculpture.model_dump() if body.sculpture else None
        try:
            item = gallery.add(body.world, body.image, sculpture, body.video)
        except InvalidImage as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _out(item)

    @app.get("/api/gallery/{item_id}/sculpture")
    def get_sculpture(item_id: str) -> dict[str, Any]:
        sculpture = gallery.sculpture(item_id)
        if sculpture is None:
            raise HTTPException(status_code=404, detail="This picture has no 3D sculpture.")
        return sculpture

    @app.delete("/api/gallery/{item_id}", status_code=204)
    def delete_image(item_id: str) -> Response:
        if not gallery.delete(item_id):
            raise HTTPException(status_code=404, detail="Image not found.")
        return Response(status_code=204)

    app.mount("/images", StaticFiles(directory=gallery.images_dir), name="images")

    # Built website (npm run build). Unknown paths get index.html so React routes work.
    if (site_dir / "index.html").is_file():
        root = site_dir.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def site(path: str) -> FileResponse:
            if path.startswith("api/"):
                raise HTTPException(status_code=404)
            candidate = (root / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
            return FileResponse(root / "index.html")

    return app


app = create_app()
