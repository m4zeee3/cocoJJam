from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.config import get_settings

# Collections the phone mirrors from its local SQLite store.
SYNCED_COLLECTIONS = ("pantry_items", "scan_history", "bookmarks", "profiles")

_client: AsyncMongoClient | None = None


def get_db() -> AsyncDatabase:
    global _client
    settings = get_settings()
    if _client is None:
        _client = AsyncMongoClient(settings.mongodb_uri, tz_aware=True)
    return _client[settings.mongodb_db]


async def close_db() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


async def ensure_indexes() -> None:
    db = get_db()
    await db.users.create_index("google_sub", unique=True)
    for name in SYNCED_COLLECTIONS:
        await db[name].create_index([("owner_id", ASCENDING), ("server_updated_at", ASCENDING)])
    await db.bookmarks.create_index([("recipe_id", ASCENDING), ("deleted", ASCENDING)])
