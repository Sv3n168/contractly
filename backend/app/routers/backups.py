import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import backup
from ..config import settings
from .auth import COOKIE, require_admin

# Backups cover the whole instance and are an admin task. They contain every user's area
# in encrypted form only, so admins cannot read other users' data through them.
router = APIRouter(prefix="/api/backups", tags=["backups"], dependencies=[Depends(require_admin)])


class BackupIn(BaseModel):
    passphrase: str | None = Field(default=None, max_length=500)
    upload: bool = False


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except backup.BackupError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("")
def overview():
    return {
        "backups": backup.list_backups(),
        "cloud": backup.cloud_status(),
        "schedule": settings.backup_schedule,
        "keep": settings.backup_keep,
        "auto_encrypted": bool(settings.backup_passphrase),
    }


@router.post("", status_code=201)
def create(data: BackupIn):
    if data.passphrase is not None and 0 < len(data.passphrase) < 8:
        raise HTTPException(400, "Der Schlüssel muss mindestens 8 Zeichen lang sein")
    path = _wrap(backup.create_backup, data.passphrase or None)
    uploaded = False
    if data.upload:
        _wrap(backup.upload, path)
        uploaded = True
    return {"name": path.name, "uploaded": uploaded}


@router.get("/{name}")
def download(name: str):
    path = _wrap(backup.backup_file, name)
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@router.post("/{name}/upload")
def upload(name: str):
    _wrap(backup.upload, _wrap(backup.backup_file, name))
    return {"uploaded": True}


@router.delete("/{name}", status_code=204)
def delete(name: str):
    _wrap(backup.backup_file, name).unlink()
    return Response(status_code=204)


@router.post("/restore")
async def restore(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    passphrase: str | None = Form(None),
):
    """``passphrase`` = backup key of a .ctly file."""
    blob = await file.read()
    # Key derivation, unpacking and the safety backup take a while: run them outside the event loop.
    result = await asyncio.to_thread(_wrap, backup.restore, blob, passphrase or None, request.state.user_id)
    if result["relogin"]:
        response.delete_cookie(COOKIE, path="/")
    return {"restored": True, **result}
