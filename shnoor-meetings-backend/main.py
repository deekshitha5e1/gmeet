import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv

from core.database import init_db
from core.reminders import start_calendar_reminder_worker, stop_calendar_reminder_worker
from routers import auth, meeting, signaling, calendar

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


def get_allowed_origins():
    configured_origins = os.getenv("FRONTEND_ORIGINS", "")
    parsed_origins = [
        origin.strip()
        for origin in configured_origins.split(",")
        if origin.strip()
    ]

    if parsed_origins:
        return parsed_origins

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

# Initialize Database
init_db()

app = FastAPI(
    title="Shnoor Meetings Backend",
    description="Backend Signaling & Chat server for Shnoor Meetings (WebRTC)",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(meeting.router)
app.include_router(signaling.router)
app.include_router(calendar.router)
app.include_router(auth.router)


@app.on_event("startup")
async def startup_background_workers():
    start_calendar_reminder_worker()


@app.on_event("shutdown")
async def shutdown_background_workers():
    stop_calendar_reminder_worker()

@app.get("/")
async def root():
    return {"message": "Welcome to the Shnoor Meetings API"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
