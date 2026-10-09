# cocoJJAM sync API

FastAPI + MongoDB Atlas backend for the optional cloud features: Google sign-in, backup and sync, and community bookmark counts.
The app itself works offline from SQLite on the phone. This server is only used when the user is signed in and online.

```
Phone (SQLite)  ⇄  this API  ⇄  MongoDB Atlas
```

The phone never connects to MongoDB directly, so no database password ships inside the app.

## Setup

Requires Python 3.11.

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # then fill in MONGODB_URI, GOOGLE_CLIENT_IDS, JWT_SECRET
uvicorn app.main:app --reload --host 0.0.0.0
```

Interactive docs: http://localhost:8000/docs

To test from a phone on the same Wi-Fi, use your laptop's LAN IP, for example `http://192.168.1.20:8000`.

## Endpoints

| Method | Path | Use case | Notes |
|---|---|---|---|
| POST | `/auth/google` | UC-11.2 | Body `{id_token}` from Google Sign-In; returns `{token, user}` |
| POST | `/auth/dev` | — | Sign in without Google; only when `DEV_AUTH=true` |
| POST | `/sync/push` | UC-11.3, UC-11.5 | Upload queued changes |
| GET | `/sync/pull?since=<cursor>` | UC-11.4, UC-11.5 | Download changes; `since=0` restores everything |
| GET | `/recipes/counts?ids=a&ids=b` | UC-3.5, UC-7.3 | Community bookmark counts; no sign-in needed |
| DELETE | `/account` | UC-11.7 | Deletes the server copy |

All endpoints except `/auth/*`, `/recipes/counts` and `/health` need `Authorization: Bearer <token>`.

## Sync contract for the app

Synced collections: `pantry_items`, `scan_history`, `bookmarks`, `profiles`.

Every local row the app syncs needs:

- `id`: a UUID made on the phone
- `updated_at`: the edit time in ms since epoch
- `deleted`: set to `true` instead of deleting the row
- `data`: the rest of the fields. A bookmark's `data` must include `recipe_id`.

```json
POST /sync/push
{"changes": {"pantry_items": [
  {"id": "3f1c…", "updated_at": 1760000000000, "deleted": false,
   "data": {"name": "Tilapia", "storage": "Ref", "cook_by": "2026-10-11"}}
]}}
```

The newer `updated_at` wins. An older edit comes back counted in `skipped_stale`.

`/sync/pull` returns a `cursor`. Store it and send it as `since` next time.
The same record may come back twice, so apply pulled records by `id` and keep the copy with the newer `updated_at`.

## Refreshing app prices

`scripts/update_prices.py` rewrites `app/src/data/prices.json` with real NCR retail prices. The data is monthly PSA prices, published by WFP on HDX under the CC BY-IGO license. The app bundles the file, so prices work offline. Rerun it before each build:

```bash
python scripts/update_prices.py
```

It updates beef, pork, chicken, fish and most recipe ingredients. Rows WFP doesn't cover stay marked `"source": "sample"`. It also reports items that moved 5% or more vs their 12-month average, so the team can write a reason tag (`reason_title` and `reason` in `prices.json`). Reason tags are curated by hand, never generated.

## Tests

The tests need a running MongoDB:

```bash
TEST_MONGODB_URI=mongodb://localhost:27017 pytest
```
