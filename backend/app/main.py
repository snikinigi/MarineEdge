"""MarineEdge API. Routes are added task by task; see docs/PLAN.md section 6."""
from fastapi import FastAPI

from app.api import health

app = FastAPI(title="MarineEdge API", version="0.1.0")
app.include_router(health.router)
