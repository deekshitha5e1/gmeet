import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.connection_manager import manager
from core.database import (
    ensure_meeting_record,
    get_db_connection,
    get_db_type,
    get_dict_cursor,
    get_meeting_record,
    get_or_create_user,
    release_db_connection,
)
from core.reminders import _dispatch_single_email

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

class InviteUserRequest(BaseModel):
    email: str
    host_name: str | None = None
    host_email: str | None = None
    frontend_origin: str | None = None

def _parse_email_list(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(email).strip().lower() for email in raw if str(email).strip()]
    try:
        import json
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(email).strip().lower() for email in parsed if str(email).strip()]
    except Exception:
        pass
    return [email.strip().lower() for email in str(raw).split(",") if email.strip()]

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
        # Check for associated calendar event to get organizer, guests, and participants.
        # Calendar-created meetings keep the definitive email list here.
        conn = get_db_connection()
        invited_emails = []
        calendar_host_email = None
        if conn:
            try:
                cursor = get_dict_cursor(conn)
                p = "%s" if get_db_type() == "postgres" else "?"
                cursor.execute(
                    f"""
                    SELECT host_email, guest_emails, participant_emails
                    FROM calendar_events
                    WHERE room_id = {p} OR id = {p}
                    """,
                    (room_id, room_id)
                )
                event_row = cursor.fetchone()
                if event_row:
                    calendar_host_email = (event_row.get("host_email") or "").strip().lower() or None
                    invited_emails.extend(_parse_email_list(event_row.get("guest_emails")))
                    invited_emails.extend(_parse_email_list(event_row.get("participant_emails")))
            finally:
                release_db_connection(conn)

        host_email = (meeting.get("host_email") or calendar_host_email or "").strip().lower() or None

        return {
            "room_id": room_id,
            "valid": True,
            "host_id": meeting.get("host_id"),
            "host_email": host_email,
            "host_name": meeting.get("host_name"),
            "invited_emails": list(set(e for e in invited_emails if e and e != host_email))
        }
    return {"room_id": room_id, "valid": False}

@router.post("/{room_id}/invite-user")
async def invite_user_to_meeting(room_id: str, payload: InviteUserRequest):
    if not room_id:
        raise HTTPException(status_code=400, detail="Invalid room ID")

    email = (payload.email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")

    try:
      meeting = get_meeting_record(room_id) or manager.get_registered_meeting(room_id)
    except Exception:
      meeting = manager.get_registered_meeting(room_id)

    if not meeting:
        ensure_meeting_record(meeting_id=room_id)

    try:
        from core.reminders import send_room_invitation_email
        send_room_invitation_email(
            room_id=room_id,
            guest_email=email,
            host_name=payload.host_name,
            host_email=payload.host_email
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send invite email: {exc}")

    return {"ok": True, "email": email}
