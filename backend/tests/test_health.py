from fastapi.testclient import TestClient

from app.api import health as health_module
from app.main import app as api

client = TestClient(api)


def test_health_ok_when_database_and_postgis_answer(monkeypatch):
    monkeypatch.setattr(health_module, "check_database", lambda: {"database": "ok", "postgis": "3.4 USE_GEOS=1"})
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok", "postgis": "3.4 USE_GEOS=1"}


def test_health_503_when_database_is_down(monkeypatch):
    monkeypatch.setattr(health_module, "check_database", lambda: {"database": "unreachable", "postgis": None})
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"


def test_health_503_when_postgis_is_missing(monkeypatch):
    monkeypatch.setattr(health_module, "check_database", lambda: {"database": "ok", "postgis": None})
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "database": "ok", "postgis": None}


def test_check_database_never_raises_and_never_leaks(monkeypatch):
    def boom():
        raise RuntimeError("password=secret host=internal")

    monkeypatch.setattr(health_module, "get_engine", boom)
    assert health_module.check_database() == {"database": "unreachable", "postgis": None}
