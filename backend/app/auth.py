from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def verify_google_id_token(token: str, settings: Settings) -> dict:
    """Return the Google claims (sub, email, name) or raise 401."""
    try:
        claims = id_token.verify_oauth2_token(token, google_requests.Request())
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid Google token: {exc}") from exc
    if claims.get("aud") not in settings.google_client_id_list:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google token was issued for another app")
    return claims


def issue_session_token(user_id: str, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=settings.jwt_ttl_days)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def current_user_id(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session") from exc
    return payload["sub"]
