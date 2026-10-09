"""Integration tests. Needs a running MongoDB:

    TEST_MONGODB_URI=mongodb://localhost:27017 pytest
"""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

TEST_URI = os.environ.get("TEST_MONGODB_URI")
pytestmark = pytest.mark.skipif(not TEST_URI, reason="TEST_MONGODB_URI not set")

TEST_DB = "cocojjam_test"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", TEST_URI)
    monkeypatch.setenv("MONGODB_DB", TEST_DB)
    monkeypatch.setenv("DEV_AUTH", "true")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    from app.config import get_settings

    get_settings.cache_clear()
    MongoClient(TEST_URI).drop_database(TEST_DB)
    from app.main import app

    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def sign_in(client, email):
    res = client.post("/auth/dev", json={"email": email})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


def record(rid, updated_at, deleted=False, **data):
    return {"id": rid, "updated_at": updated_at, "deleted": deleted, "data": data}


def test_requires_auth(client):
    assert client.get("/sync/pull").status_code == 401


def test_push_then_pull_restores_data(client):
    h = sign_in(client, "a@example.com")
    item = str(uuid4())
    res = client.post("/sync/push", headers=h, json={"changes": {
        "pantry_items": [record(item, 100, name="Tilapia", storage="Ref")],
    }})
    assert res.json() == {"applied": 1, "skipped_stale": 0}

    pulled = client.get("/sync/pull", params={"since": 0}, headers=h).json()
    assert pulled["changes"]["pantry_items"][0]["data"]["name"] == "Tilapia"


def test_newer_edit_wins(client):
    h = sign_in(client, "a@example.com")
    item = str(uuid4())
    client.post("/sync/push", headers=h, json={"changes": {"pantry_items": [record(item, 200, name="new")]}})
    res = client.post("/sync/push", headers=h, json={"changes": {"pantry_items": [record(item, 100, name="old")]}})
    assert res.json() == {"applied": 0, "skipped_stale": 1}

    pulled = client.get("/sync/pull", headers=h).json()
    assert pulled["changes"]["pantry_items"][0]["data"]["name"] == "new"


def test_users_cannot_overwrite_each_other(client):
    a = sign_in(client, "a@example.com")
    b = sign_in(client, "b@example.com")
    item = str(uuid4())
    client.post("/sync/push", headers=a, json={"changes": {"pantry_items": [record(item, 100, name="mine")]}})
    res = client.post("/sync/push", headers=b, json={"changes": {"pantry_items": [record(item, 999, name="stolen")]}})
    assert res.json()["applied"] == 0
    assert client.get("/sync/pull", headers=b).json()["changes"]["pantry_items"] == []
    assert client.get("/sync/pull", headers=a).json()["changes"]["pantry_items"][0]["data"]["name"] == "mine"


def test_bookmark_counts(client):
    a = sign_in(client, "a@example.com")
    b = sign_in(client, "b@example.com")
    bm_a, bm_b = str(uuid4()), str(uuid4())
    client.post("/sync/push", headers=a, json={"changes": {"bookmarks": [record(bm_a, 1, recipe_id="sinigang")]}})
    client.post("/sync/push", headers=b, json={"changes": {"bookmarks": [record(bm_b, 1, recipe_id="sinigang")]}})
    counts = client.get("/recipes/counts", params={"ids": ["sinigang", "adobo"]}).json()
    assert counts == {"sinigang": 2, "adobo": 0}

    client.post("/sync/push", headers=b, json={"changes": {"bookmarks": [record(bm_b, 2, deleted=True, recipe_id="sinigang")]}})
    assert client.get("/recipes/counts", params={"ids": ["sinigang"]}).json() == {"sinigang": 1}


def test_delete_account(client):
    h = sign_in(client, "a@example.com")
    client.post("/sync/push", headers=h, json={"changes": {"pantry_items": [record(str(uuid4()), 1, name="x")]}})
    assert client.delete("/account", headers=h).status_code == 204
    assert client.get("/sync/pull", headers=h).json()["changes"]["pantry_items"] == []
