import asyncio
import base64
import binascii
import logging
import secrets
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import db as database
from . import demo
from .backup import backup_loop
from .config import settings
from .models import Contract
from .reminders import notifier_loop
from .routers import backups, contracts, documents, offers, reminders, stats

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if database.engine is None:
        database.init_db()
    with database.SessionLocal() as db:
        documents.cleanup_unassigned(db)
    tasks = []
    if app.state.background:
        tasks = [asyncio.create_task(notifier_loop(database.SessionLocal)), asyncio.create_task(backup_loop())]
    yield
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def _authorized(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return False
    try:
        user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
    except (binascii.Error, UnicodeDecodeError):
        return False
    return secrets.compare_digest(user, settings.username) and secrets.compare_digest(password, settings.password)


def create_app(background: bool = True) -> FastAPI:
    app = FastAPI(title="Contractly", version="1.0.0", lifespan=lifespan)
    app.state.background = background

    @app.middleware("http")
    async def basic_auth(request: Request, call_next):
        if settings.password and request.url.path != "/healthz" and not _authorized(request):
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Contractly", charset="UTF-8"'},
            )
        return await call_next(request)

    for r in (
        contracts.router,
        offers.router,
        documents.router,
        stats.router,
        reminders.router,
        backups.router,
    ):
        app.include_router(r)

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"ok": True}

    @app.post("/api/demo", tags=["meta"])
    def load_demo(db: Session = Depends(database.get_db)):
        if db.scalar(select(func.count(Contract.id))):
            raise HTTPException(400, "Demo-Daten können nur in eine leere Datenbank geladen werden")
        return {"created": demo.seed(db)}

    @app.exception_handler(ValueError)
    async def value_error(_request: Request, exc: ValueError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    static = settings.static_dir
    if static.is_dir():
        app.mount("/static", StaticFiles(directory=static), name="static")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})

        for name in ("manifest.webmanifest", "sw.js", "icon.svg"):
            path = static / name

            def _serve(path=path):
                return FileResponse(path, headers={"Cache-Control": "no-cache"})

            app.add_api_route(f"/{name}", _serve, include_in_schema=False)

    return app


app = create_app()
