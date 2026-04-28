import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.connection_manager import manager
from core.database import ensure_meeting_record, get_meeting_record, get_or_create_user

router = APIRouter(
    prefix="/api/meetings",
    tags=["Meetings"]
)

class CreateMeetingResponse(BaseModel):
    room_id: str
    message: str

class CreateMeetingRequest(BaseModel):
    room_id: str | None = None
    host_id: str | None = None
    host_email: str | None = None
    host_name: str | None = None
    firebase_uid: str | None = None

class JoinMeetingRequest(BaseModel):
    room_id: str

@router.post("/create", response_model=CreateMeetingResponse)
async def create_meeting(payload: CreateMeetingRequest | None = None):
    """
    Creates a unique meeting ID that can be shared with other participants.
    """
    room_id = payload.room_id if payload and payload.room_id else str(uuid.uuid4())
    host_id = payload.host_id if payload and payload.host_id else None
    host_email = payload.host_email if payload and payload.host_email else None
    host_name = payload.host_name if payload and payload.host_name else None
    firebase_uid = payload.firebase_uid if payload and payload.firebase_uid else None
    manager.register_meeting(room_id, host_id=host_id, host_email=host_email, host_name=host_name)

    try:
        if host_email or host_name or firebase_uid:
            host_id = get_or_create_user(
                user_id=host_id,
                firebase_uid=firebase_uid,
                name=host_name,
                email=host_email,
            )
            manager.register_meeting(room_id, host_id=host_id, host_email=host_email, host_name=host_name)

        ensure_meeting_record(meeting_id=room_id, host_user_id=host_id)
    except Exception as e:
        print(f"Error saving meeting record: {e}")

    return {
        "room_id": room_id,
        "message": "Meeting created successfully"
    }

@router.get("/{room_id}")
async def check_meeting(room_id: str):
    """
    Checks if a meeting ID exists in the database.
    """
    if not room_id:
        raise HTTPException(status_code=400, detail="Invalid room ID")

    try:
        meeting = get_meeting_record(room_id)
    except Exception as e:
        meeting = manager.get_registered_meeting(room_id)
        if not meeting:
            raise HTTPException(status_code=500, detail=f"Failed to check meeting: {str(e)}")

    if not meeting:
        meeting = manager.get_registered_meeting(room_id)

    if meeting:
        return {
            "room_id": room_id,
            "valid": True,
            "host_id": meeting.get("host_id"),
            "host_email": meeting.get("host_email"),
            "host_name": meeting.get("host_name"),
        }
    return {"room_id": room_id, "valid": False}
