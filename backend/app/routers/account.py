from fastapi import APIRouter, Depends, Response, status

from app.auth import current_user_id
from app.db import SYNCED_COLLECTIONS, get_db

router = APIRouter(prefix="/account", tags=["account"])


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(user_id: str = Depends(current_user_id)):
    """Delete the server copy (UC-11.7). Data on the phone stays unless cleared there."""
    db = get_db()
    for collection in SYNCED_COLLECTIONS:
        await db[collection].delete_many({"owner_id": user_id})
    await db.users.delete_one({"_id": user_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
