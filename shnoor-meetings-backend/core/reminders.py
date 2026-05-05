import logging
import os
import smtplib
import socket
import threading
import urllib.request
import urllib.error
import json
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.database import get_db_connection, get_dict_cursor, release_db_connection

logger = logging.getLogger(__name__)
DEFAULT_REMINDER_OFFSET_MINUTES = int((os.getenv("CALENDAR_REMINDER_OFFSET_MINUTES") or "5").strip() or "5")
REMINDER_POLL_INTERVAL_SECONDS = int((os.getenv("CALENDAR_REMINDER_POLL_INTERVAL_SECONDS") or "15").strip() or "15")
REMINDER_GRACE_WINDOW_MINUTES = int((os.getenv("CALENDAR_REMINDER_GRACE_WINDOW_MINUTES") or "30").strip() or "30")

_reminder_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()

FRONTEND_URL = (os.getenv("FRONTEND_URL") or "https://gmeet-wt19.vercel.app").rstrip("/")


# ─── SMTP / Resend Config ────────────────────────────────────────────────────

def _get_smtp_settings():
    host = (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
    port = int((os.getenv("SMTP_PORT") or "465").strip() or "465")
    use_ssl = (os.getenv("SMTP_USE_SSL") or ("True" if port == 465 else "False")).strip().lower() == "true"
    use_tls = (os.getenv("SMTP_USE_TLS") or ("False" if port == 465 else "True")).strip().lower() == "true"

    return {
        "host": host,
        "port": port,
        "username": (os.getenv("SMTP_USERNAME") or "").strip(),
        "password": (os.getenv("SMTP_PASSWORD") or "").strip(),
        "from_email": (os.getenv("SMTP_FROM_EMAIL") or "").strip(),
        "from_name": (os.getenv("SMTP_FROM_NAME") or "Shnoor Meetings").strip(),
        "use_tls": use_tls,
        "use_ssl": use_ssl,
        "timeout_seconds": int((os.getenv("SMTP_TIMEOUT_SECONDS") or "45").strip() or "45"),
    }


def _smtp_is_configured():
    s = _get_smtp_settings()
    return all([s["host"], s["port"], s["username"], s["password"], s["from_email"]])


def _get_missing_smtp_keys():
    s = _get_smtp_settings()
    keys = []
    if not s["host"]: keys.append("SMTP_HOST")
    if not s["username"]: keys.append("SMTP_USERNAME")
    if not s["password"]: keys.append("SMTP_PASSWORD")
    if not s["from_email"]: keys.append("SMTP_FROM_EMAIL")
    return keys


def _get_resend_settings():
    return {
        "api_key": (os.getenv("RESEND_API_KEY") or "").strip(),
        "from_email": (os.getenv("RESEND_FROM_EMAIL") or "").strip() or (os.getenv("SMTP_FROM_EMAIL") or "").strip(),
        "from_name": (os.getenv("RESEND_FROM_NAME") or "").strip() or (os.getenv("SMTP_FROM_NAME") or "Shnoor Meetings").strip(),
    }


def _resend_is_configured():
    s = _get_resend_settings()
    return all([s["api_key"], s["from_email"]])


def _get_missing_resend_keys():
    s = _get_resend_settings()
    keys = []
    if not s["api_key"]: keys.append("RESEND_API_KEY")
    if not s["from_email"]: keys.append("RESEND_FROM_EMAIL")
    return keys


# ─── Time Formatting ──────────────────────────────────────────────────────────

def _format_dt(value) -> str:
    from datetime import timedelta
    if not value:
        return "—"
    
    try:
        if isinstance(value, datetime):
            dt = value
        else:
            # Handle ISO strings (Z or offset)
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        
        # Convert to IST (UTC + 5:30)
        ist_offset = timedelta(hours=5, minutes=30)
        # If dt is naive, assume it is UTC. If it has tzinfo, convert it.
        if dt.tzinfo is None:
            ist_dt = dt + ist_offset
        else:
            from datetime import timezone
            ist_dt = dt.astimezone(timezone(ist_offset))
            
        return ist_dt.strftime("%B %d, %Y at %I:%M %p IST")
    except Exception as e:
        print(f"Error formatting date {value}: {e}")
        return str(value)


def _get_meet_link(event: dict) -> str:
    room_id = event.get("room_id")
    if not room_id:
        return ""
    frontend_url = (os.getenv("FRONTEND_URL") or FRONTEND_URL).rstrip("/")
    return f"{frontend_url}/meeting/{room_id}?role=participant"


def _parse_emails(event: dict):
    """Returns (host_email, guest_emails_list)"""
    raw = (event.get("user_email") or "").strip()
    parts = [e.strip() for e in raw.split(",") if e.strip()]
    host = parts[0] if parts else ""
    guests = parts[1:] if len(parts) > 1 else []
    return host, guests


# ─── HTML Email Builder ───────────────────────────────────────────────────────

def _build_html_email(event: dict, heading: str, intro_line: str) -> tuple[str, str]:
    """Returns (plain_text, html_string)"""
    title = event.get("title") or "Untitled Meeting"
    description = event.get("description") or ""
    category = ((event.get("category") or "meeting").rstrip("s")).capitalize()
    start_str = _format_dt(event.get("start_time"))
    end_str = _format_dt(event.get("end_time")) if event.get("end_time") else None
    time_range = start_str + (f" → {end_str}" if end_str else "")
    meet_link = _get_meet_link(event)
    host_email, guest_emails = _parse_emails(event)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    # ── Plain text version ──
    plain_parts = [
        heading,
        "",
        intro_line,
        "",
        f"📅 {title}",
        f"🕐 {time_range}",
        f"📁 Category: {category}",
    ]
    if host_email:
        plain_parts.append(f"👤 Organizer: {host_email}")
    if guest_emails:
        plain_parts.append(f"👥 Participants: {', '.join(guest_emails)}")
    if description:
        plain_parts.append(f"📝 Description: {description}")
    plain_parts.append(f"🔔 Reminder: {reminder_mins} min before")
    if meet_link:
        plain_parts += ["", f"🔗 Join Meeting: {meet_link}"]
    plain_parts += ["", "— Shnoor Meetings Team", "https://gmeet-wt19.vercel.app"]
    plain_text = "\n".join(plain_parts)

    # ── HTML version ──
    guest_rows = ""
    if guest_emails:
        items = "".join(
            f'<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;'
            f'border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:13px;">{g}</span>'
            for g in guest_emails
        )
        guest_rows = f"""
        <tr>
          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;">Participants</td>
          <td style="padding:6px 0;font-size:13px;color:#111827;">{items}</td>
        </tr>"""

    description_row = ""
    if description:
        description_row = f"""
        <tr>
          <td colspan="2" style="padding-top:12px;">
            <div style="background:#F9FAFB;border-left:3px solid #6366F1;border-radius:4px;padding:10px 14px;color:#374151;font-size:13px;line-height:1.6;font-style:italic;">
              {description}
            </div>
          </td>
        </tr>"""

    join_button = ""
    if meet_link:
        join_button = f"""
        <div style="text-align:center;margin:32px 0 20px;">
          <a href="{meet_link}"
             style="background:#2563EB;color:#ffffff;text-decoration:none;padding:14px 40px;
                    border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.5px;
                    display:inline-block;box-shadow:0 4px 14px rgba(37,99,235,0.35);">
            ▶&nbsp; Join Meeting Now
          </a>
          <div style="margin-top:12px;color:#9CA3AF;font-size:11px;">Or copy this link: {meet_link}</div>
        </div>"""

    host_row = ""
    if host_email:
        host_row = f"""
        <tr>
          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;">Organizer</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{host_email}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{heading}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1D4ED8 0%,#4F46E5 100%);padding:36px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">📹 Shnoor Meetings</div>
            <div style="color:#BFDBFE;margin-top:6px;font-size:14px;">{heading}</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 24px;">{intro_line}</p>

            <!-- Meeting Card -->
            <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:24px;margin-bottom:24px;">
              <div style="font-size:20px;font-weight:700;color:#111827;margin-bottom:16px;">{title}</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;">Date &amp; Time</td>
                  <td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{time_range}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6B7280;font-size:13px;">Category</td>
                  <td style="padding:6px 0;font-size:13px;color:#111827;">
                    <span style="background:#ECFDF5;color:#059669;border-radius:999px;padding:2px 10px;font-weight:600;">{category}</span>
                  </td>
                </tr>
                {host_row}
                {guest_rows}
                <tr>
                  <td style="padding:6px 0;color:#6B7280;font-size:13px;">Reminder</td>
                  <td style="padding:6px 0;font-size:13px;color:#D97706;font-weight:600;">🔔 {reminder_mins} minutes before</td>
                </tr>
                {description_row}
              </table>
            </div>

            {join_button}

            <hr style="border:none;border-top:1px solid #F3F4F6;margin:28px 0;">
            <p style="font-size:12px;color:#9CA3AF;text-align:center;margin:0;">
              This email was sent by <strong>Shnoor Meetings</strong>. You received it because you are a participant of this meeting.<br>
              <a href="{FRONTEND_URL}" style="color:#6366F1;text-decoration:none;">Open Shnoor Meetings</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    return plain_text, html


# ─── Subject Lines ────────────────────────────────────────────────────────────

def _build_reminder_subject(event: dict) -> str:
    title = event.get("title") or "Untitled"
    offset = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES
    return f"⏰ Reminder: '{title}' starts in {offset} minutes"


def _build_scheduled_subject(event: dict) -> str:
    title = event.get("title") or "Untitled"
    return f"✅ Meeting Scheduled: {title}"


# ─── Compatibility shims (kept for any callers using old API) ─────────────────

def _build_reminder_body(event: dict) -> str:
    _, html = _build_html_email(
        event,
        heading="Meeting Reminder",
        intro_line=f"Your meeting starts in {event.get('reminder_offset_minutes') or DEFAULT_REMINDER_OFFSET_MINUTES} minutes. Get ready!",
    )
    return html


def _build_scheduled_body(event: dict) -> str:
    _, html = _build_html_email(
        event,
        heading="Meeting Scheduled",
        intro_line=f"Hi {event.get('user_name') or 'there'}, your meeting has been successfully scheduled. Here are the details:",
    )
    return html


# ─── Send Helpers ─────────────────────────────────────────────────────────────

def _send_email_via_smtp(event: dict, subject: str, plain_text: str, html_body: str):
    settings = _get_smtp_settings()
    raw = (event.get("user_email") or "").strip()
    recipients = [e.strip() for e in raw.split(",") if e.strip()]
    if not recipients:
        raise ValueError("Calendar event has no recipient email")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings['from_name']} <{settings['from_email']}>"
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    errors = []
    # Try multiple ports (465, 587) to bypass provider blocks and timeouts
    ports_to_try = [settings["port"]]
    if 465 not in ports_to_try: ports_to_try.append(465)
    if 587 not in ports_to_try: ports_to_try.append(587)
    
    for port in ports_to_try:
        try:
            logger.info("Attempting SMTP connection to %s:%d (timeout=%ds)", settings["host"], port, settings["timeout_seconds"])
            
            # Re-resolve host for IPv4 safety
            try:
                resolved_host = socket.gethostbyname(settings["host"])
            except Exception:
                resolved_host = settings["host"]

            smtp_cls = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
            
            with smtp_cls(host=resolved_host, port=port, timeout=settings["timeout_seconds"]) as server:
                server.ehlo()
                if port == 587:
                    server.starttls()
                    server.ehlo()
                
                server.login(settings["username"], settings["password"])
                server.send_message(msg)
                logger.info("Email sent successfully via port %d", port)
                return
        except Exception as e:
            logger.warning("SMTP attempt failed on port %d: %s", port, e)
            errors.append(f"Port {port}: {str(e)}")
            continue

    raise RuntimeError(f"All SMTP attempts failed: {'; '.join(errors)}")


def _send_email_via_resend(event: dict, subject: str, plain_text: str, html_body: str):
    settings = _get_resend_settings()
    raw = (event.get("user_email") or "").strip()
    recipients = [e.strip() for e in raw.split(",") if e.strip()]
    if not recipients:
        raise ValueError("Calendar event has no recipient email")

    payload = {
        "from": f"{settings['from_name']} <{settings['from_email']}>",
        "to": recipients,
        "subject": subject,
        "text": plain_text,
        "html": html_body,
    }

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "ShnoorMeetings/1.0 (Integration; Python)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status >= 400:
                body_resp = response.read().decode("utf-8", errors="ignore")
                raise RuntimeError(f"Resend API failed with status {response.status}: {body_resp}")
    except urllib.error.HTTPError as exc:
        body_resp = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Resend API error {exc.code}: {body_resp}") from exc


def _dispatch_email(event: dict, subject: str, heading: str, intro_line: str):
    """Build HTML email and send via SMTP or Resend. Raises if neither configured."""
    plain_text, html_body = _build_html_email(event, heading=heading, intro_line=intro_line)
    
    settings = _get_smtp_settings()
    raw = (event.get("user_email") or "").strip()
    recipients = [e.strip() for e in raw.split(",") if e.strip()]
    
    logger.info("Attempting to dispatch email: subject='%s', recipients=%s", subject, recipients)

    if _resend_is_configured():
        try:
            _send_email_via_resend(event, subject, plain_text, html_body)
            logger.info("Email successfully sent via Resend to %s", recipients)
            return
        except Exception as resend_err:
            logger.error("Resend delivery failed: %s", resend_err, exc_info=True)
            raise

    if _smtp_is_configured():
        try:
            _send_email_via_smtp(event, subject, plain_text, html_body)
            logger.info("Email successfully sent via SMTP to %s", recipients)
            return
        except Exception as smtp_err:
            logger.error("SMTP delivery failed: %s", smtp_err, exc_info=True)
            raise

    raise RuntimeError(
        "No email provider configured or all providers failed. "
        f"Missing SMTP keys: {', '.join(_get_missing_smtp_keys()) or 'none'}; "
        f"Missing Resend keys: {', '.join(_get_missing_resend_keys()) or 'none'}."
    )


# ─── Public API ───────────────────────────────────────────────────────────────

def send_calendar_reminder_email(event: dict):
    """Send a 'starting soon' reminder to all participants."""
    offset = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES
    _dispatch_email(
        event,
        subject=_build_reminder_subject(event),
        heading="⏰ Meeting Reminder",
        intro_line=f"Your meeting starts in <strong>{offset} minutes</strong>. Get ready to join!",
    )


def send_meeting_scheduled_email(event: dict):
    """Send a confirmation email when a meeting is first created/updated."""
    name = event.get("user_name") or "there"
    _dispatch_email(
        event,
        subject=_build_scheduled_subject(event),
        heading="✅ Meeting Scheduled",
        intro_line=f"Hi <strong>{name}</strong>, your meeting has been successfully scheduled. Here are the full details:",
    )


# ─── Background Reminder Worker ───────────────────────────────────────────────

def process_pending_calendar_reminders():
    if not _smtp_is_configured() and not _resend_is_configured():
        logger.warning(
            "Calendar reminders skipped — email provider incomplete. SMTP missing: %s | Resend missing: %s",
            ", ".join(_get_missing_smtp_keys()) or "none",
            ", ".join(_get_missing_resend_keys()) or "none",
        )
        return

    conn = get_db_connection()
    if not conn:
        logger.warning("Calendar reminders skipped — database connection unavailable.")
        return

    try:
        from core.database import get_db_type
        db_type = get_db_type()
        cursor = get_dict_cursor(conn)

        if db_type == "postgres":
            cursor.execute(
                """
                SELECT
                    calendar_events.id,
                    calendar_events.title,
                    calendar_events.description,
                    calendar_events.category,
                    calendar_events.start_time,
                    calendar_events.end_time,
                    calendar_events.room_id,
                    calendar_events.reminder_offset_minutes,
                    LOWER(BTRIM(COALESCE(calendar_events.recipient_email, users.email))) AS user_email,
                    users.name AS user_name
                FROM calendar_events
                LEFT JOIN users ON users.id = calendar_events.user_id
                WHERE calendar_events.reminder_sent_at IS NULL
                  AND COALESCE(calendar_events.recipient_email, users.email) IS NOT NULL
                  AND (calendar_events.start_time - make_interval(mins => COALESCE(calendar_events.reminder_offset_minutes, %s))) <= NOW()
                  AND calendar_events.start_time >= (NOW() - make_interval(mins => %s))
                  AND LOWER(COALESCE(calendar_events.category, 'meetings')) IN ('meetings', 'meeting', 'personal', 'reminders', 'reminder', 'remainder', 'remainders')
                ORDER BY calendar_events.start_time ASC
                """,
                (DEFAULT_REMINDER_OFFSET_MINUTES, REMINDER_GRACE_WINDOW_MINUTES),
            )
        else:
            # SQLite version
            cursor.execute(
                """
                SELECT
                    calendar_events.id,
                    calendar_events.title,
                    calendar_events.description,
                    calendar_events.category,
                    calendar_events.start_time,
                    calendar_events.end_time,
                    calendar_events.room_id,
                    calendar_events.reminder_offset_minutes,
                    LOWER(TRIM(IFNULL(calendar_events.recipient_email, users.email))) AS user_email,
                    users.name AS user_name
                FROM calendar_events
                LEFT JOIN users ON users.id = calendar_events.user_id
                WHERE calendar_events.reminder_sent_at IS NULL
                  AND IFNULL(calendar_events.recipient_email, users.email) IS NOT NULL
                  AND datetime(calendar_events.start_time, '-' || IFNULL(calendar_events.reminder_offset_minutes, ?) || ' minutes') <= CURRENT_TIMESTAMP
                  AND calendar_events.start_time >= datetime(CURRENT_TIMESTAMP, '-' || ? || ' minutes')
                  AND LOWER(IFNULL(calendar_events.category, 'meetings')) IN ('meetings', 'meeting', 'personal', 'reminders', 'reminder', 'remainder', 'remainders')
                ORDER BY calendar_events.start_time ASC
                """,
                (DEFAULT_REMINDER_OFFSET_MINUTES, REMINDER_GRACE_WINDOW_MINUTES),
            )

        pending_events = cursor.fetchall()

        for event in pending_events:
            event_data = dict(event)
            try:
                send_calendar_reminder_email(event_data)
                now_val = "NOW()" if db_type == "postgres" else "CURRENT_TIMESTAMP"
                p = "%s" if db_type == "postgres" else "?"
                cursor.execute(
                    f"UPDATE calendar_events SET reminder_sent_at = {now_val} WHERE id = {p}",
                    (event_data["id"],),
                )
                conn.commit()
                logger.info("Sent reminder for event %s to %s", event_data["id"], event_data.get("user_email"))
            except Exception as exc:
                conn.rollback()
                logger.exception("Failed to send reminder for event %s: %s", event_data.get("id"), exc)

    except Exception as exc:
        conn.rollback()
        logger.exception("Calendar reminder processing failed: %s", exc)
    finally:
        release_db_connection(conn)


def _reminder_loop():
    while not _stop_event.wait(REMINDER_POLL_INTERVAL_SECONDS):
        process_pending_calendar_reminders()


def start_calendar_reminder_worker():
    global _reminder_thread

    if _reminder_thread and _reminder_thread.is_alive():
        return

    _stop_event.clear()
    process_pending_calendar_reminders()
    _reminder_thread = threading.Thread(
        target=_reminder_loop,
        name="calendar-reminder-worker",
        daemon=True,
    )
    _reminder_thread.start()
    logger.info("Calendar reminder worker started.")


def stop_calendar_reminder_worker():
    _stop_event.set()
    logger.info("Calendar reminder worker stopped.")
