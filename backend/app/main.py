"""Aether backend: gallery API, saved images and (after a build) the website itself."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .gallery import Gallery, GalleryItem, InvalidImage

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_SITE_DIR = BACKEND_DIR.parent / "frontend" / "dist"

World = Literal["hand", "draw", "mirror", "voice"]


class SaveImage(BaseModel):
    world: World
    image: str = Field(description="Base64 data URL of a PNG, JPEG or WebP image")


class ImageOut(BaseModel):
    id: str
    world: str
    created_at: str
    url: str


def _out(item: GalleryItem) -> ImageOut:
    return ImageOut(id=item.id, world=item.world, created_at=item.created_at, url=f"/images/{item.filename}")


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
        try:
            item = gallery.add(body.world, body.image)
        except InvalidImage as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _out(item)

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
