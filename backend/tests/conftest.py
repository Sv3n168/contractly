import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import db as database
    from app.config import settings

    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "documents_dir", tmp_path / "documents")
    monkeypatch.setattr(settings, "backup_dir", tmp_path / "backups")
    monkeypatch.setattr(settings, "password", "")
    database.init_db(f"sqlite:///{tmp_path / 'test.db'}")

    from app.main import create_app

    with TestClient(create_app(background=False)) as c:
        yield c
    database.engine.dispose()
    database.engine = None
