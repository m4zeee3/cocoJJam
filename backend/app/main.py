from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import close_db, ensure_indexes
from app.routers import account, auth, recipes, sync


@asynccontextmanager
async def lifespan(_: FastAPI):
    await ensure_indexes()
    yield
    await close_db()


app = FastAPI(title="cocoJJAM sync API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(recipes.router)
app.include_router(account.router)


@app.get("/health")
async def health():
    return {"ok": True}
