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
            user_record = get_or_create_user(
                user_id=host_id,
                firebase_uid=firebase_uid,
                name=host_name,
                email=host_email,
            )
            if isinstance(user_record, dict):
                host_id = user_record.get("id")
            manager.register_meeting(room_id, host_id=host_id, host_email=host_email, host_name=host_name)

        ensure_meeting_record(meeting_id=room_id, host_user_id=host_id)
    except Exception as e:
        import traceback
        print(f"Error saving meeting record: {e}")
        print(traceback.format_exc())

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
        # Check for associated calendar event to get guests/participants
        conn = get_db_connection()
        invited_emails = []
        if conn:
            try:
                cursor = get_dict_cursor(conn)
                p = "%s" if get_db_type() == "postgres" else "?"
                cursor.execute(
                    f"SELECT guest_emails, participant_emails FROM calendar_events WHERE room_id = {p} OR id = {p}",
                    (room_id, room_id)
                )
                event_row = cursor.fetchone()
                if event_row:
                    import json
                    guests = event_row.get("guest_emails")
                    if guests:
                        try:
                            invited_emails.extend(json.loads(guests) if isinstance(guests, str) else guests)
                        except: pass
                    parts = event_row.get("participant_emails")
                    if parts:
                        try:
                            invited_emails.extend(json.loads(parts) if isinstance(parts, str) else parts)
                        except: pass
            finally:
                release_db_connection(conn)

        return {
            "room_id": room_id,
            "valid": True,
            "host_id": meeting.get("host_id"),
            "host_email": meeting.get("host_email"),
            "host_name": meeting.get("host_name"),
            "invited_emails": list(set(e.lower().strip() for e in invited_emails if e))
        }
    return {"room_id": room_id, "valid": False}
