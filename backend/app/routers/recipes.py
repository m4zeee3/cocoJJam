from fastapi import APIRouter, Query

from app.db import get_db

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.get("/counts", response_model=dict[str, int])
async def bookmark_counts(ids: list[str] = Query(..., max_length=200)):
    """Community bookmark count per recipe (UC-3.5, UC-7.3). Open to guests.

    Counted live from synced bookmarks, so a removed bookmark lowers the count
    without a separate counter to keep in step.
    """
    pipeline = [
        {"$match": {"data.recipe_id": {"$in": ids}, "deleted": False}},
        {"$group": {"_id": "$data.recipe_id", "users": {"$addToSet": "$owner_id"}}},
        {"$project": {"count": {"$size": "$users"}}},
    ]
    counts = {recipe_id: 0 for recipe_id in ids}
    async for row in await get_db().bookmarks.aggregate(pipeline):
        counts[row["_id"]] = row["count"]
    return counts
