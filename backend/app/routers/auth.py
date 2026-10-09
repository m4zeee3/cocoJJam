from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo import ReturnDocument

from app.auth import issue_session_token, verify_google_id_token
from app.config import Settings, get_settings
from app.db import get_db
from app.models import DevSignIn, GoogleSignIn, SessionOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


async def _upsert_user(google_sub: str, email: str, name: str) -> UserOut:
    """Create the user on first sign-in, or load it (UC-11.2)."""
    user = await get_db().users.find_one_and_update(
        {"google_sub": google_sub},
        {"$set": {"email": email, "name": name}, "$setOnInsert": {"_id": str(uuid4())}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return UserOut(id=user["_id"], email=user["email"], name=user["name"])


@router.post("/google", response_model=SessionOut)
async def sign_in_with_google(body: GoogleSignIn, settings: Settings = Depends(get_settings)):
    claims = verify_google_id_token(body.id_token, settings)
    user = await _upsert_user(claims["sub"], claims.get("email", ""), claims.get("name", ""))
    return SessionOut(token=issue_session_token(user.id, settings), user=user)


@router.post("/dev", response_model=SessionOut)
async def sign_in_dev(body: DevSignIn, settings: Settings = Depends(get_settings)):
    """Sign in without Google, for local testing only (DEV_AUTH=true)."""
    if not settings.dev_auth:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    user = await _upsert_user(f"dev:{body.email}", body.email, body.name)
    return SessionOut(token=issue_session_token(user.id, settings), user=user)
