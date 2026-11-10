import base64

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 32).decode()


@pytest.fixture
def client(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("<h1>aether</h1>")
    (site / "app.js").write_text("console.log(1)")
    return TestClient(create_app(data_dir=tmp_path / "data", site_dir=site)), tmp_path


def test_save_list_and_serve_image(client):
    api, _ = client
    res = api.post("/api/gallery", json={"world": "hand", "image": f"data:image/png;base64,{PNG}"})
    assert res.status_code == 201
    item = res.json()
    assert item["world"] == "hand"
    assert item["url"].endswith(".png")

    listed = api.get("/api/gallery").json()
    assert [i["id"] for i in listed] == [item["id"]]

    image = api.get(item["url"])
    assert image.status_code == 200
    assert image.content.startswith(b"\x89PNG")


def test_newest_first(client):
    api, _ = client
    first = api.post("/api/gallery", json={"world": "hand", "image": f"data:image/png;base64,{PNG}"}).json()
    second = api.post("/api/gallery", json={"world": "draw", "image": f"data:image/jpeg;base64,{JPEG}"}).json()
    ids = [i["id"] for i in api.get("/api/gallery").json()]
    assert ids == [second["id"], first["id"]]


def test_delete_removes_row_and_file(client):
    api, tmp_path = client
    item = api.post("/api/gallery", json={"world": "hand", "image": f"data:image/png;base64,{PNG}"}).json()
    filename = item["url"].rsplit("/", 1)[1]
    assert (tmp_path / "data" / "images" / filename).exists()

    assert api.delete(f"/api/gallery/{item['id']}").status_code == 204
    assert api.get("/api/gallery").json() == []
    assert not (tmp_path / "data" / "images" / filename).exists()
    assert api.delete(f"/api/gallery/{item['id']}").status_code == 404


@pytest.mark.parametrize(
    "image",
    [
        "not a data url",
        "data:image/gif;base64,R0lGODlh",
        "data:image/png;base64,%%%notbase64",
        f"data:image/png;base64,{JPEG}",  # says png, is jpeg
        "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * (8 * 1024 * 1024)).decode(),
    ],
)
def test_rejects_bad_images(client, image):
    api, _ = client
    res = api.post("/api/gallery", json={"world": "hand", "image": image})
    assert res.status_code == 422
    assert api.get("/api/gallery").json() == []


def test_rejects_unknown_world(client):
    api, _ = client
    res = api.post("/api/gallery", json={"world": "moon", "image": f"data:image/png;base64,{PNG}"})
    assert res.status_code == 422


def test_serves_site_with_spa_fallback(client):
    api, _ = client
    assert api.get("/app.js").text == "console.log(1)"
    assert "aether" in api.get("/hand").text
    assert "aether" in api.get("/../../etc/passwd").text
    assert api.get("/api/nothing").status_code == 404
