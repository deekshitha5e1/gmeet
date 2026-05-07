import json
import os
import uuid
import threading
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from core.database import (
    ensure_meeting_record,
    get_db_connection,
    get_dict_cursor,
    get_or_create_user,
    normalize_uuid_or_none,
    release_db_connection,
    get_db_type,
)
from core.reminders import (
    process_pending_calendar_reminders,
    send_calendar_reminder_email,
    send_invitation_emails
)

router = APIRouter(
    prefix="/api/calendar",
    tags=["Calendar"]
)

DEFAULT_REMINDER_OFFSET_MINUTES = int((os.getenv("CALENDAR_REMINDER_OFFSET_MINUTES") or "10").strip() or "10")


def normalize_event_category(category: Optional[str]) -> str:
    normalized = (category or "meetings").strip().lower()
    aliases = {
        "meeting": "meetings",
        "meetings": "meetings",
        "personal": "personal",
        "reminder": "reminders",
        "reminders": "reminders",
        "remainder": "reminders",
        "remainders": "reminders",
        "task": "reminders",
        "tasks": "reminders",
        "event": "meetings",
        "events": "meetings",
    }
    return aliases.get(normalized, "meetings")

class CalendarEvent(BaseModel):
    id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    guest_emails: Optional[List[str]] = []
    title: str
    description: Optional[str] = ""
    start_time: datetime
    end_time: datetime
    category: str = "meetings"
    room_id: Optional[str] = None
    reminder_offset_minutes: Optional[int] = 10
    location: Optional[str] = ""
    guest_permissions: Optional[str] = "{}"
    participant_emails: Optional[List[str]] = []

class CalendarEventCreate(BaseModel):
    id: Optional[str] = None          # client may supply a stable UUID
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    guest_emails: Optional[List[str]] = []
    title: str
    description: Optional[str] = ""
    start_time: datetime
    end_time: datetime
    category: str = "meetings"
    room_id: Optional[str] = None
    reminder_offset_minutes: Optional[int] = 10
    location: Optional[str] = ""
    guest_permissions: Optional[str] = "{}"
    participant_emails: Optional[List[str]] = []

class CreateEventResponse(BaseModel):
    id: str
    message: str


def trigger_calendar_reminder_check():
    threading.Thread(
        target=process_pending_calendar_reminders,
        name="calendar-reminder-kick",
        daemon=True,
    ).start()


@router.post("/reminders/test")
async def send_test_reminder(email: str = Query(..., min_length=3)):
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="A valid email is required")

    test_event = {
        "id": "manual-reminder-test",
        "title": "SMTP Reminder Test",
        "category": "meetings",
        "start_time": datetime.utcnow() + timedelta(minutes=5),
        "reminder_offset_minutes": 5,
        "user_email": normalized_email,
    }

    try:
        send_calendar_reminder_email(test_event)
        return {"message": f"Test reminder sent to {normalized_email}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send test reminder: {str(exc)}")

@router.get("/events", response_model=List[CalendarEvent])
async def get_events(
    user_id: Optional[str] = Query(default=None),
    user_email: Optional[str] = Query(default=None),
):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection is unavailable")

    try:
        db_type = get_db_type()
        cursor = get_dict_cursor(conn)
        p = "%s" if db_type == "postgres" else "?"
        
        normalized_email = (user_email or "").strip().lower() or None
        normalized_user_id = normalize_uuid_or_none(user_id)

        query_parts = []
        query_params = []

        if normalized_email:
            like_pattern = f"%{normalized_email}%"
            query_parts.append(f"LOWER(COALESCE(calendar_events.recipient_email, users.email, '')) LIKE {p}")
            query_params.append(like_pattern)
        
        if normalized_user_id:
            query_parts.append(f"calendar_events.user_id = {p}")
            query_params.append(normalized_user_id)

        where_clause = " OR ".join(query_parts) if query_parts else "1=1"
        
        cursor.execute(
            f"""
            SELECT calendar_events.*, COALESCE(calendar_events.recipient_email, users.email) AS user_email
            FROM calendar_events
            LEFT JOIN users ON users.id = calendar_events.user_id
            WHERE {where_clause}
            ORDER BY calendar_events.start_time ASC
            LIMIT 50
            """,
            tuple(query_params),
        )
        
        rows = cursor.fetchall()
        events = []
        for row in rows:
            r = dict(row)
            recipient_email = r.get("recipient_email") or r.get("user_email") or ""
            emails_list = [e.strip() for e in recipient_email.split(",") if e.strip()]
            host_email = emails_list[0] if emails_list else r.get("user_email")
            guest_emails = emails_list[1:] if len(emails_list) > 1 else []
            events.append(
                CalendarEvent(
                    id=str(r.get("id")),
                    user_id=str(r.get("user_id")) if r.get("user_id") else None,
                    user_email=host_email,
                    guest_emails=guest_emails,
                    title=r.get("title") or "Untitled",
                    description=r.get("description") or "",
                    start_time=r.get("start_time"),
                    end_time=r.get("end_time"),
                    category=normalize_event_category(r.get("category")),
                    room_id=str(r.get("room_id")) if r.get("room_id") else None,
                    reminder_offset_minutes=r.get("reminder_offset_minutes", DEFAULT_REMINDER_OFFSET_MINUTES),
                    location=r.get("location") or "",
                    guest_permissions=r.get("guest_permissions") or "{}",
                    participant_emails=json.loads(r.get("participant_emails") or "[]")
                )
            )
        return events
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch events: {str(e)}")
    finally:
        release_db_connection(conn)

@router.post("/events", response_model=CreateEventResponse)
async def create_event(event: CalendarEventCreate):
    import traceback
    try:
        event_id = normalize_uuid_or_none(event.id) or str(uuid.uuid4())

        user_id = get_or_create_user(
            user_id=event.user_id,
            name=event.user_name or "Calendar User",
            email=event.user_email,
        )
        if isinstance(user_id, dict):
            user_id = user_id.get("id")

        category = normalize_event_category(event.category)
        room_id = normalize_uuid_or_none(event.room_id)
        if room_id:
            ensure_meeting_record(room_id, host_user_id=user_id, title=event.title)

        # Host email = event creator
        host_email = (event.user_email or "").strip().lower()

        # Guest emails — validated and deduplicated
        guest_list = []
        for em in (event.guest_emails or []):
            normalized = (em or "").strip().lower()
            if normalized and normalized != host_email and normalized not in guest_list:
                guest_list.append(normalized)
        guest_emails_json = json.dumps(guest_list)

        # Backward-compat: keep recipient_email as comma-joined all emails
        all_emails = ([host_email] if host_email else []) + guest_list
        recipient_emails_str = ",".join(all_emails) if all_emails else None

        # Compute reminder_time = start_time - reminder_offset_minutes
        reminder_mins = event.reminder_offset_minutes or DEFAULT_REMINDER_OFFSET_MINUTES
        reminder_time = event.start_time - timedelta(minutes=reminder_mins)

        # Participant emails — validated and deduplicated
        participant_list = []
        for em in (event.participant_emails or []):
            normalized = (em or "").strip().lower()
            if normalized and normalized != host_email and normalized not in participant_list:
                participant_list.append(normalized)
        participant_emails_json = json.dumps(participant_list)

        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="Database connection is unavailable")

        try:
            db_type = get_db_type()
            cursor = get_dict_cursor(conn)
            p = "%s" if db_type == "postgres" else "?"

            placeholders = ", ".join([p] * 16)
            cursor.execute(
                f"""
                INSERT INTO calendar_events
                  (id, user_id, recipient_email, host_email, guest_emails,
                   title, description, start_time, end_time, category,
                   room_id, reminder_offset_minutes, reminder_time, location, guest_permissions, participant_emails)
                VALUES ({placeholders})
                """,
                (
                    event_id,
                    user_id,
                    recipient_emails_str,
                    host_email,
                    guest_emails_json,
                    event.title,
                    event.description,
                    event.start_time,
                    event.end_time,
                    category,
                    room_id,
                    reminder_mins,
                    reminder_time,
                    event.location,
                    event.guest_permissions,
                    participant_emails_json,
                )
            )
            conn.commit()
        finally:
            release_db_connection(conn)

        # Emails are NOT sent immediately — the background scheduler handles delivery
        # when reminder_time is reached.
        # UPDATE: Immediate invitation emails are now sent for all involved parties.
        try:
            event_dict = {
                "id": event_id,
                "title": event.title,
                "description": event.description,
                "category": category,
                "start_time": event.start_time,
                "end_time": event.end_time,
                "room_id": room_id,
                "reminder_offset_minutes": reminder_mins,
                "host_email": host_email,
                "guest_emails": guest_emails_json,
                "participant_emails": participant_emails_json,
                "location": event.location
            }
            print(f"Triggering immediate invitation emails for {event_id}. Recipients: {all_emails}")
            threading.Thread(
                target=send_invitation_emails,
                args=(event_dict,),
                name=f"invitation-email-{event_id}",
                daemon=True
            ).start()
        except Exception as e:
            print(f"Non-fatal: Failed to trigger invitation emails: {e}")

        return {"id": event_id, "message": "Event created successfully"}
    except Exception as e:
        print(f"ERROR in create_event: {e}")
        traceback.print_exc()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@router.delete("/events/{id}")
async def delete_event(id: str):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection is unavailable")

    try:
        db_type = get_db_type()
        cursor = get_dict_cursor(conn)
        p = "%s" if db_type == "postgres" else "?"
        cursor.execute(f"DELETE FROM calendar_events WHERE id = {p}", (id,))
        conn.commit()
    except Exception as e:
        if "conn" in locals() and conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete event: {str(e)}")
    finally:
        release_db_connection(conn)

    return {"message": "Event deleted successfully"}

@router.put("/events/{id}")
async def update_event(id: str, event: CalendarEvent):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection is unavailable")

    try:
        db_type = get_db_type()
        cursor = get_dict_cursor(conn)
        p = "%s" if db_type == "postgres" else "?"

        event_user_id = get_or_create_user(
            user_id=event.user_id,
            name=event.user_name or "Calendar User",
            email=event.user_email,
        )
        if isinstance(event_user_id, dict):
            event_user_id = event_user_id.get("id")

        category = normalize_event_category(event.category)
        room_id = normalize_uuid_or_none(event.room_id)
        if room_id:
            ensure_meeting_record(room_id, host_user_id=event_user_id, title=event.title)

        host_email = (event.user_email or "").strip().lower()
        guest_list = []
        for em in (event.guest_emails or []):
            normalized = (em or "").strip().lower()
            if normalized and normalized != host_email and normalized not in guest_list:
                guest_list.append(normalized)
        guest_emails_json = json.dumps(guest_list)

        all_emails = ([host_email] if host_email else []) + guest_list
        recipient_emails_str = ",".join(all_emails) if all_emails else None

        reminder_mins = event.reminder_offset_minutes or DEFAULT_REMINDER_OFFSET_MINUTES
        reminder_time = event.start_time - timedelta(minutes=reminder_mins)

        participant_list = []
        for em in (event.participant_emails or []):
            normalized = (em or "").strip().lower()
            if normalized and normalized != host_email and normalized not in participant_list:
                participant_list.append(normalized)
        participant_emails_json = json.dumps(participant_list)

        cursor.execute(
            f"""
            UPDATE calendar_events
            SET user_id = {p},
                recipient_email = {p},
                host_email = {p},
                guest_emails = {p},
                title = {p},
                description = {p},
                start_time = {p},
                end_time = {p},
                category = {p},
                room_id = {p},
                reminder_offset_minutes = {p},
                reminder_time = {p},
                location = {p},
                guest_permissions = {p},
                participant_emails = {p},
                reminder_sent_at = NULL,
                notification_sent = 0
            WHERE id = {p}
            """,
            (
                event_user_id,
                recipient_emails_str,
                host_email,
                guest_emails_json,
                event.title,
                event.description,
                event.start_time,
                event.end_time,
                category,
                room_id,
                reminder_mins,
                reminder_time,
                event.location,
                event.guest_permissions,
                participant_emails_json,
                id,
            )
        )
        conn.commit()

        # Trigger immediate invitation emails for updates as well
        try:
            event_dict = {
                "id": id,
                "title": event.title,
                "description": event.description,
                "category": category,
                "start_time": event.start_time,
                "end_time": event.end_time,
                "room_id": room_id,
                "reminder_offset_minutes": reminder_mins,
                "host_email": host_email,
                "guest_emails": guest_emails_json,
                "participant_emails": participant_emails_json,
                "location": event.location
            }
            print(f"Triggering update invitation emails for {id}.")
            threading.Thread(
                target=send_invitation_emails,
                args=(event_dict,),
                name=f"update-invitation-email-{id}",
                daemon=True
            ).start()
        except Exception as e:
            print(f"Non-fatal: Failed to trigger update invitation emails: {e}")

        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Event not found")
    except Exception as e:
        if isinstance(e, HTTPException):
            if "conn" in locals() and conn:
                conn.rollback()
            raise e
        if "conn" in locals() and conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update event: {str(e)}")
    finally:
        release_db_connection(conn)

    # Emails NOT sent immediately — scheduler handles delivery at reminder_time.

    return {"message": "Event updated successfully"}
