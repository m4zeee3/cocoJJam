import time

from fastapi import APIRouter, Depends, Query
from pymongo import UpdateOne
from pymongo.errors import BulkWriteError

from app.auth import current_user_id
from app.db import SYNCED_COLLECTIONS, get_db
from app.models import PullResponse, PushRequest, PushResult, SyncRecord

router = APIRouter(prefix="/sync", tags=["sync"])

DUPLICATE_KEY = 11000
# A pull hands back a cursor this far in the past, so a push still in flight
# when the pull ran is picked up next time. Re-sent records are harmless:
# the phone applies them by id and updated_at.
SYNC_LAG_MS = 5_000


def _now_ms() -> int:
    return int(time.time() * 1000)


@router.post("/push", response_model=PushResult)
async def push(body: PushRequest, user_id: str = Depends(current_user_id)):
    """Upload changes the phone queued while offline (UC-11.3, UC-11.5)."""
    db = get_db()
    now = _now_ms()
    applied = stale = 0
    for collection, records in body.changes.items():
        if not records:
            continue
        # Only overwrite a stored copy that is older. If the stored copy is
        # newer (or belongs to someone else) the filter misses, the upsert
        # tries to insert a duplicate _id, and that record counts as stale.
        ops = [
            UpdateOne(
                {"_id": str(r.id), "owner_id": user_id, "updated_at": {"$lt": r.updated_at}},
                {"$set": {
                    "owner_id": user_id,
                    "updated_at": r.updated_at,
                    "deleted": r.deleted,
                    "data": r.data,
                    "server_updated_at": now,
                }},
                upsert=True,
            )
            for r in records
        ]
        try:
            result = await db[collection].bulk_write(ops, ordered=False)
            applied += result.upserted_count + result.modified_count
        except BulkWriteError as exc:
            details = exc.details
            errors = details.get("writeErrors", [])
            if any(e["code"] != DUPLICATE_KEY for e in errors):
                raise
            applied += details.get("nUpserted", 0) + details.get("nModified", 0)
            stale += len(errors)
    return PushResult(applied=applied, skipped_stale=stale)


@router.get("/pull", response_model=PullResponse)
async def pull(since: int = Query(0, ge=0), user_id: str = Depends(current_user_id)):
    """Download everything changed since the last pull (UC-11.4, UC-11.5).

    Pass since=0 on a new phone to restore the whole account.
    """
    db = get_db()
    cursor = max(_now_ms() - SYNC_LAG_MS, since)
    changes: dict[str, list[SyncRecord]] = {}
    for collection in SYNCED_COLLECTIONS:
        docs = db[collection].find({"owner_id": user_id, "server_updated_at": {"$gt": since}})
        changes[collection] = [
            SyncRecord(id=d["_id"], updated_at=d["updated_at"], deleted=d["deleted"], data=d["data"])
            async for d in docs
        ]
    return PullResponse(cursor=cursor, changes=changes)
