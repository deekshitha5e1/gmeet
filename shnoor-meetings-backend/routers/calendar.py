import os
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
)
from core.reminders import process_pending_calendar_reminders, send_calendar_reminder_email, send_meeting_scheduled_email

router = APIRouter(
    prefix="/api/calendar",
    tags=["Calendar"]
)

DEFAULT_REMINDER_OFFSET_MINUTES = int((os.getenv("CALENDAR_REMINDER_OFFSET_MINUTES") or "5").strip() or "5")


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
        cursor = get_dict_cursor(conn)
        normalized_user_id = normalize_uuid_or_none(user_id)
        if user_id and not normalized_user_id:
            raise HTTPException(status_code=400, detail="Invalid user ID")

        normalized_email = (user_email or "").strip().lower() or None

        if normalized_email:
            cursor.execute(
                """
                SELECT calendar_events.*, COALESCE(calendar_events.recipient_email, users.email) AS user_email
                FROM calendar_events
                LEFT JOIN users ON users.id = calendar_events.user_id
                WHERE LOWER(COALESCE(calendar_events.recipient_email, users.email, '')) = %s
                ORDER BY calendar_events.start_time ASC
                """,
                (normalized_email,),
            )
        elif normalized_user_id:
            cursor.execute(
                """
                SELECT calendar_events.*, COALESCE(calendar_events.recipient_email, users.email) AS user_email
                FROM calendar_events
                LEFT JOIN users ON users.id = calendar_events.user_id
                WHERE calendar_events.user_id = %s
                ORDER BY calendar_events.start_time ASC
                """,
                (normalized_user_id,),
            )
        else:
            cursor.execute(
                """
                SELECT calendar_events.*, COALESCE(calendar_events.recipient_email, users.email) AS user_email
                FROM calendar_events
                LEFT JOIN users ON users.id = calendar_events.user_id
                ORDER BY calendar_events.start_time ASC
                """
            )
        rows = cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch events: {str(e)}")
    finally:
        release_db_connection(conn)
    
    events = []
    for row in rows:
        recipient_email = row.get("recipient_email") or row.get("user_email") or ""
        emails_list = [e.strip() for e in recipient_email.split(",") if e.strip()]
        host_email = emails_list[0] if emails_list else row.get("user_email")
        guest_emails = emails_list[1:] if len(emails_list) > 1 else []
        events.append(
            CalendarEvent(
                id=row["id"],
                user_id=row["user_id"],
                user_email=host_email,
                guest_emails=guest_emails,
                title=row["title"],
                description=row["description"],
                start_time=row["start_time"],
                end_time=row["end_time"],
                category=normalize_event_category(row["category"]),
                room_id=row["room_id"]
            )
        )
    return events

@router.post("/events", response_model=CreateEventResponse)
async def create_event(event: CalendarEvent):
    try:
        event_id = normalize_uuid_or_none(event.id)
        if not event_id:
            raise HTTPException(status_code=400, detail="A frontend-generated event ID is required")

        user_id = get_or_create_user(
            user_id=event.user_id,
            name=event.user_name or "Calendar User",
            email=event.user_email,
        )
        category = normalize_event_category(event.category)
        room_id = normalize_uuid_or_none(event.room_id)
        if room_id:
            ensure_meeting_record(room_id, host_user_id=user_id, title=event.title)

        all_emails = []
        host_email = (event.user_email or "").strip().lower()
        if host_email:
            all_emails.append(host_email)
        if event.guest_emails:
            for em in event.guest_emails:
                normalized_em = (em or "").strip().lower()
                if normalized_em and normalized_em not in all_emails:
                    all_emails.append(normalized_em)
        recipient_emails_str = ",".join(all_emails) if all_emails else None

        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="Database connection is unavailable")

        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            INSERT INTO calendar_events (id, user_id, recipient_email, title, description, start_time, end_time, category, room_id, reminder_offset_minutes, reminder_sent_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
            """,
            (
                event_id,
                user_id,
                recipient_emails_str,
                event.title,
                event.description,
                event.start_time,
                event.end_time,
                category,
                room_id,
                DEFAULT_REMINDER_OFFSET_MINUTES,
            )
        )
        conn.commit()
    except Exception as e:
        if isinstance(e, HTTPException):
            if "conn" in locals() and conn:
                conn.rollback()
            raise e
        if "conn" in locals() and conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create event: {str(e)}")
    finally:
        if "conn" in locals() and conn:
            release_db_connection(conn)

    trigger_calendar_reminder_check()

    if event.user_email and category in ["meetings", "meeting"]:
        event_dict = {
            "title": event.title,
            "category": category,
            "start_time": event.start_time,
            "room_id": room_id,
            "user_email": event.user_email,
        }
        try:
            send_meeting_scheduled_email(event_dict)
        except Exception as e:
            print(f"Failed to send scheduled meeting email: {e}")

    return {"id": event_id, "message": "Event created successfully"}

@router.delete("/events/{id}")
async def delete_event(id: str):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection is unavailable")

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute("DELETE FROM calendar_events WHERE id = %s", (id,))
        conn.commit()
    except Exception as e:
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

    cursor = get_dict_cursor(conn)
    
    try:
        event_user_id = get_or_create_user(
            user_id=event.user_id,
            name=event.user_name or "Calendar User",
            email=event.user_email,
        )
        category = normalize_event_category(event.category)
        room_id = normalize_uuid_or_none(event.room_id)
        if room_id:
            ensure_meeting_record(room_id, host_user_id=event_user_id, title=event.title)

        all_emails = []
        host_email = (event.user_email or "").strip().lower()
        if host_email:
            all_emails.append(host_email)
        if event.guest_emails:
            for em in event.guest_emails:
                normalized_em = (em or "").strip().lower()
                if normalized_em and normalized_em not in all_emails:
                    all_emails.append(normalized_em)
        recipient_emails_str = ",".join(all_emails) if all_emails else None

        cursor.execute(
            """
            UPDATE calendar_events
            SET user_id = %s,
                recipient_email = %s,
                title = %s,
                description = %s,
                start_time = %s,
                end_time = %s,
                category = %s,
                room_id = %s,
                reminder_offset_minutes = %s,
                reminder_sent_at = NULL
            WHERE id = %s
            """,
            (
                event_user_id,
                recipient_emails_str,
                event.title,
                event.description,
                event.start_time,
                event.end_time,
                category,
                room_id,
                DEFAULT_REMINDER_OFFSET_MINUTES,
                id,
            )
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Event not found")
    except Exception as e:
        if isinstance(e, HTTPException):
            conn.rollback()
            raise e
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update event: {str(e)}")
    finally:
        release_db_connection(conn)

    trigger_calendar_reminder_check()
    return {"message": "Event updated successfully"}
