"""Health check: is the app up, and does the database answer with PostGIS installed?"""
from fastapi import APIRouter, Response
from sqlalchemy import text

from app.db.session import get_engine

router = APIRouter()


def check_database() -> dict:
    """Return {"database": "ok" | "unreachable", "postgis": version text or None}.

    Never raises and never returns error text, so a failure cannot leak a host name or a password.
    """
    result = {"database": "unreachable", "postgis": None}
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
            result["database"] = "ok"
            try:
                result["postgis"] = conn.execute(text("SELECT PostGIS_Version()")).scalar_one()
            except Exception:
                conn.rollback()
    except Exception:
        pass
    return result


@router.get("/health")
def health(response: Response) -> dict:
    db = check_database()
    ok = db["database"] == "ok" and db["postgis"] is not None
    if not ok:
        response.status_code = 503
    return {"status": "ok" if ok else "degraded", **db}
