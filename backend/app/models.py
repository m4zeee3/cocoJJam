from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

CollectionName = Literal["pantry_items", "scan_history", "bookmarks", "profiles"]


class GoogleSignIn(BaseModel):
    id_token: str


class DevSignIn(BaseModel):
    email: str
    name: str = "Dev User"


class UserOut(BaseModel):
    id: str
    email: str
    name: str


class SessionOut(BaseModel):
    token: str
    user: UserOut


class SyncRecord(BaseModel):
    """One row from the phone's SQLite store.

    `id` is a UUID made on the phone, so records created offline never collide.
    `updated_at` is the phone's edit time in ms; the newer edit wins.
    Deletes are sent as `deleted: true` so other devices learn about them.
    """

    id: UUID
    updated_at: int = Field(ge=0)
    deleted: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


class PushRequest(BaseModel):
    changes: dict[CollectionName, list[SyncRecord]] = Field(default_factory=dict)


class PushResult(BaseModel):
    applied: int
    skipped_stale: int


class PullResponse(BaseModel):
    cursor: int
    changes: dict[str, list[SyncRecord]]
