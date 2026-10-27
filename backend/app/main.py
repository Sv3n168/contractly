import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import db as database
from . import demo
from .backup import backup_loop
from .config import settings
from .models import Contract
from .reminders import notifier_loop, refresh_outbox
from .routers import (
    auth,
    backups,
    checkup,
    contracts,
    data,
    documents,
    emergency,
    imports,
    inbox,
    income,
    loans,
    offers,
    reminders,
    stats,
)
from .routers.auth import COOKIE
from .security import vault

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# Reachable without login: the app shell, the login API and token-protected calendar feeds.
PUBLIC_PATHS = {"/", "/healthz", "/manifest.webmanifest", "/sw.js", "/icon.svg"}
PUBLIC_API = {
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/recover",
    "/api/auth/activate",
}

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)

# The camera is used via <input capture>, which needs no permission; everything else is off.
PERMISSIONS = "camera=(self), microphone=(), geolocation=(), payment=(), usb=()"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def is_public(path: str) -> bool:
    return (
        path in PUBLIC_PATHS
        or path in PUBLIC_API
        or path.startswith("/static/")
        or (path.startswith("/api/calendar/") and path.endswith(".ics"))
        or path == "/api/ha/summary"  # own Bearer token
    )


def _on_user_locked(user_id: str) -> None:
    """A user's key was wiped (logout/expiry): keep reminders deliverable, then close the database."""
    try:
        refresh_outbox(user_id)
    except Exception:  # noqa: BLE001
        logging.getLogger("contractly").exception("could not refresh reminder outbox")
    database.close_database(user_id)


def _session_user(token: str | None) -> str:
    """User id of a valid session with the user's area opened, or the reason why there is none."""
    if not vault.initialized:
        return "setup_required"
    user_id = vault.session_user(token)
    if not user_id:
        return "auth_required"
    if not database.is_open(user_id):
        # Valid session after a restart or on another instance: open the area with its key.
        auth.open_user_area(user_id)
    return user_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    # All user databases stay closed (encrypted) until their owner logs in.
    settings.ensure_dirs()
    auth.log_setup_code()
    tasks = []
    if app.state.background:
        tasks = [asyncio.create_task(notifier_loop()), asyncio.create_task(backup_loop())]
    yield
    # Only drop the in-memory keys: sessions stay valid across restarts and other instances.
    vault.forget_keys()
    database.close_all()
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app(background: bool = True) -> FastAPI:
    app = FastAPI(title="Contractly", version="1.0.0", lifespan=lifespan)
    app.state.background = background
    vault.on_lock = _on_user_locked

    @app.middleware("http")
    async def require_login(request: Request, call_next):
        path = request.url.path
        request.state.user_id = None
        # Browsers mark requests from other sites; changing data that way is never legitimate (CSRF).
        if request.method not in SAFE_METHODS and request.headers.get("sec-fetch-site") in ("cross-site", "same-site"):
            return JSONResponse(status_code=403, content={"detail": "Anfrage von fremder Seite abgelehnt"})
        if not is_public(path):
            # File and database access (users.json, sessions.db, opening the area) off the event loop.
            user_id = await asyncio.to_thread(_session_user, request.cookies.get(COOKIE))
            if user_id in ("setup_required", "auth_required"):
                return JSONResponse(status_code=401, content={"detail": user_id})
            request.state.user_id = user_id
            database.current_user.set(user_id)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", PERMISSIONS)
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if request.url.scheme == "https":  # behind a TLS proxy (X-Forwarded-Proto from a trusted proxy)
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        elif path.startswith("/static/"):
            # Revalidate every time (cheap 304s): otherwise browsers and proxies like Cloudflare keep
            # serving the old app for hours after an update.
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    for r in (
        auth.router,
        auth.users_router,
        contracts.router,
        offers.router,
        documents.router,
        stats.router,
        reminders.router,
        backups.router,
        imports.router,
        inbox.router,
        checkup.router,
        emergency.router,
        loans.router,
        income.router,
        data.router,
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

    @app.exception_handler(database.DatabaseLocked)
    async def locked(_request: Request, _exc: database.DatabaseLocked):
        return JSONResponse(status_code=401, content={"detail": "auth_required"})

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
