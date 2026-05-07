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

    frontend_origin = (payload.frontend_origin or "").strip().rstrip("/")
    if not frontend_origin:
        import os
        frontend_origin = (os.getenv("FRONTEND_URL") or "https://gmeet-wt19.vercel.app").rstrip("/")

    meet_link = f"{frontend_origin}/meeting/{room_id}?role=participant&email={email}"
    host_display = (payload.host_name or payload.host_email or "The host").strip()
    subject = "Invitation to join a Shnoor Meeting"
    plain_text = (
        f"{host_display} invited you to join a live meeting on Shnoor Meetings.\n\n"
        f"Join the meeting: {meet_link}\n\n"
        "After opening the link, click Ask to join and wait for the host to admit you."
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#111827;">
      <div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <h2 style="margin:0 0 12px;font-size:22px;">Join a Shnoor Meeting</h2>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
          <strong>{host_display}</strong> invited you to join a live meeting.
        </p>
        <a href="{meet_link}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
          Join the meet
        </a>
        <p style="margin:18px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
          You will enter the waiting room first. Click Ask to join, and the host will admit you.
        </p>
        <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;word-break:break-all;">
          {meet_link}
        </p>
      </div>
    </div>
    """

    try:
        _dispatch_single_email(email, subject, plain_text, html_body, reply_to=(payload.host_email or ""))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send invite email: {exc}")

    return {"ok": True, "email": email}
