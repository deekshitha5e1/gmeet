import json
import logging
import os
import smtplib
import socket
import threading
import urllib.request
import urllib.error
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.database import get_db_connection, get_dict_cursor, release_db_connection

logger = logging.getLogger(__name__)

DEFAULT_REMINDER_OFFSET_MINUTES = int((os.getenv("CALENDAR_REMINDER_OFFSET_MINUTES") or "5").strip() or "5")
REMINDER_POLL_INTERVAL_SECONDS = int((os.getenv("CALENDAR_REMINDER_POLL_INTERVAL_SECONDS") or "60").strip() or "60")

_reminder_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()

FRONTEND_URL = (os.getenv("FRONTEND_URL") or "https://gmeet-wt19.vercel.app").rstrip("/")


# ─── SMTP / Resend Config ─────────────────────────────────────────────────────

def _get_smtp_settings():
    host = (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
    port = int((os.getenv("SMTP_PORT") or "587").strip() or "587")
    use_ssl = port == 465
    use_tls = port == 587
    return {
        "host": host,
        "port": port,
        "username": (os.getenv("SMTP_USERNAME") or "").strip(),
        "password": (os.getenv("SMTP_PASSWORD") or "").strip(),
        "from_email": (os.getenv("SMTP_FROM_EMAIL") or "").strip(),
        "from_name": (os.getenv("SMTP_FROM_NAME") or "Shnoor Meetings").strip(),
        "use_tls": use_tls,
        "use_ssl": use_ssl,
        "timeout_seconds": int((os.getenv("SMTP_TIMEOUT_SECONDS") or "30").strip() or "30"),
    }


def _smtp_is_configured():
    s = _get_smtp_settings()
    return all([s["host"], s["port"], s["username"], s["password"], s["from_email"]])


def _get_resend_settings():
    return {
        "api_key": (os.getenv("RESEND_API_KEY") or "").strip(),
        "from_email": (os.getenv("RESEND_FROM_EMAIL") or "").strip() or (os.getenv("SMTP_FROM_EMAIL") or "").strip(),
        "from_name": (os.getenv("RESEND_FROM_NAME") or "").strip() or (os.getenv("SMTP_FROM_NAME") or "Shnoor Meetings").strip(),
    }


def _resend_is_configured():
    s = _get_resend_settings()
    return all([s["api_key"], s["from_email"]])


def _get_missing_smtp_keys():
    s = _get_smtp_settings()
    return [k for k in ["host", "username", "password", "from_email"] if not s[k]]


def _get_missing_resend_keys():
    s = _get_resend_settings()
    return [k for k in ["api_key", "from_email"] if not s[k]]


# ─── Time Formatting ──────────────────────────────────────────────────────────

def _format_dt(value) -> str:
    from datetime import timedelta
    if not value:
        return "—"
    try:
        if isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        ist_offset = timedelta(hours=5, minutes=30)
        if dt.tzinfo is None:
            ist_dt = dt + ist_offset
        else:
            from datetime import timezone
            ist_dt = dt.astimezone(timezone(ist_offset))
        return ist_dt.strftime("%B %d, %Y at %I:%M %p IST")
    except Exception as e:
        logger.warning("Error formatting date %s: %s", value, e)
        return str(value)


def _get_meet_link(event: dict) -> str:
    room_id = event.get("room_id")
    if not room_id:
        return ""
    frontend_url = (os.getenv("FRONTEND_URL") or FRONTEND_URL).rstrip("/")
    return f"{frontend_url}/meeting/{room_id}?role=participant"


def _parse_guest_emails(event: dict) -> list:
    """Parse guest_emails field (JSON string or list) from event dict."""
    raw = event.get("guest_emails")
    if not raw:
        return []
    if isinstance(raw, list):
        return [e.strip() for e in raw if e and e.strip()]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [e.strip() for e in parsed if e and e.strip()]
    except Exception:
        pass
    # Fallback: comma-separated
    return [e.strip() for e in str(raw).split(",") if e.strip()]


# ─── HTML Email Builder ───────────────────────────────────────────────────────

def _build_email_html(
    title: str,
    heading: str,
    intro_line: str,
    start_time,
    end_time,
    host_email: str,
    guest_emails: list,
    description: str,
    meet_link: str,
    reminder_mins: int,
) -> tuple:
    """Returns (plain_text, html_string)."""
    category = "Meeting"
    start_str = _format_dt(start_time)
    end_str = _format_dt(end_time) if end_time else None
    time_range = start_str + (f" → {end_str}" if end_str else "")

    # Plain text
    plain_parts = [heading, "", intro_line, "",
                   f"📅 {title}", f"🕐 {time_range}"]
    if host_email:
        plain_parts.append(f"👤 Organizer: {host_email}")
    if guest_emails:
        plain_parts.append(f"👥 Participants: {', '.join(guest_emails)}")
    if description:
        plain_parts.append(f"📝 {description}")
    plain_parts.append(f"🔔 Reminder: {reminder_mins} min before")
    if meet_link:
        plain_parts += ["", f"🔗 Join: {meet_link}"]
    plain_parts += ["", "— Shnoor Meetings", FRONTEND_URL]
    plain_text = "\n".join(plain_parts)

    # Guest tags
    guest_html = ""
    if guest_emails:
        tags = "".join(
            f'<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;'
            f'border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:13px;">{g}</span>'
            for g in guest_emails
        )
        guest_html = f"""
        <tr>
          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;">Participants</td>
          <td style="padding:6px 0;font-size:13px;color:#111827;">{tags}</td>
        </tr>"""

    desc_html = ""
    if description:
        desc_html = f"""
        <tr>
          <td colspan="2" style="padding-top:12px;">
            <div style="background:#F9FAFB;border-left:3px solid #6366F1;border-radius:4px;padding:10px 14px;color:#374151;font-size:13px;line-height:1.6;font-style:italic;">
              {description}
            </div>
          </td>
        </tr>"""

    btn_html = ""
    if meet_link:
        btn_html = f"""
        <div style="text-align:center;margin:32px 0 20px;">
          <a href="{meet_link}"
             style="background:#2563EB;color:#ffffff;text-decoration:none;padding:14px 40px;
                    border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.5px;
                    display:inline-block;box-shadow:0 4px 14px rgba(37,99,235,0.35);">
            ▶&nbsp; Join Meeting Now
          </a>
          <div style="margin-top:12px;color:#9CA3AF;font-size:11px;">Or copy: {meet_link}</div>
        </div>"""

    host_html = ""
    if host_email:
        host_html = f"""
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
        <tr>
          <td style="background:linear-gradient(135deg,#1D4ED8 0%,#4F46E5 100%);padding:36px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">📹 Shnoor Meetings</div>
            <div style="color:#BFDBFE;margin-top:6px;font-size:14px;">{heading}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 24px;">{intro_line}</p>
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
                {host_html}
                {guest_html}
                <tr>
                  <td style="padding:6px 0;color:#6B7280;font-size:13px;">Reminder</td>
                  <td style="padding:6px 0;font-size:13px;color:#D97706;font-weight:600;">🔔 {reminder_mins} minutes before</td>
                </tr>
                {desc_html}
              </table>
            </div>
            {btn_html}
            <hr style="border:none;border-top:1px solid #F3F4F6;margin:28px 0;">
            <p style="font-size:12px;color:#9CA3AF;text-align:center;margin:0;">
              This email was sent by <strong>Shnoor Meetings</strong>.<br>
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


# ─── Send Helpers ─────────────────────────────────────────────────────────────

def _send_via_smtp(to_email: str, subject: str, plain_text: str, html_body: str, reply_to: str = ""):
    settings = _get_smtp_settings()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings['from_name']} <{settings['from_email']}>"
    msg["To"] = to_email
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    ports_to_try = [settings["port"]]
    if 465 not in ports_to_try:
        ports_to_try.append(465)
    if 587 not in ports_to_try:
        ports_to_try.append(587)

    errors = []
    for port in ports_to_try:
        try:
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
                logger.info("Email sent via SMTP port %d to %s", port, to_email)
                return
        except Exception as e:
            errors.append(f"Port {port}: {e}")
    raise RuntimeError(f"All SMTP attempts failed: {'; '.join(errors)}")


def _send_via_resend(to_email: str, subject: str, plain_text: str, html_body: str, reply_to: str = ""):
    settings = _get_resend_settings()
    payload = {
        "from": f"{settings['from_name']} <{settings['from_email']}>",
        "to": [to_email],
        "subject": subject,
        "text": plain_text,
        "html": html_body,
    }
    if reply_to:
        payload["reply_to"] = [reply_to]

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "ShnoorMeetings/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status >= 400:
                body = resp.read().decode("utf-8", errors="ignore")
                raise RuntimeError(f"Resend API error {resp.status}: {body}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Resend API error {exc.code}: {body}") from exc


def _dispatch_single_email(to_email: str, subject: str, plain_text: str, html_body: str, reply_to: str = ""):
    """Send one email to one recipient via Resend or SMTP."""
    logger.info("Dispatching email to=%s subject='%s' reply_to=%s", to_email, subject, reply_to)
    if _resend_is_configured():
        _send_via_resend(to_email, subject, plain_text, html_body, reply_to)
        return
    if _smtp_is_configured():
        _send_via_smtp(to_email, subject, plain_text, html_body, reply_to)
        return
    raise RuntimeError(
        f"No email provider configured. Missing SMTP: {_get_missing_smtp_keys()}; Missing Resend: {_get_missing_resend_keys()}"
    )


# ─── Public Email Senders ─────────────────────────────────────────────────────

def send_host_reminder_email(event: dict):
    """Send reminder email to the HOST of the meeting."""
    host_email = (event.get("host_email") or "").strip()
    if not host_email:
        logger.warning("send_host_reminder_email: no host_email for event %s", event.get("id"))
        return

    title = event.get("title") or "Untitled Meeting"
    subject = f"✅ Meeting Reminder: {title}"
    heading = "⏰ Meeting Reminder"
    intro_line = f"Hi, your meeting <strong>{title}</strong> is starting soon. Here are the details:"

    guest_emails = _parse_guest_emails(event)
    meet_link = _get_meet_link(event)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
    )
    _dispatch_single_email(host_email, subject, plain_text, html_body, reply_to="")


def send_guest_reminder_email(event: dict, guest_email: str):
    """Send reminder/invitation email to one GUEST participant."""
    host_email = (event.get("host_email") or "").strip()
    guest_email = guest_email.strip()
    if not guest_email:
        return

    title = event.get("title") or "Untitled Meeting"
    subject = f"📅 Meeting Reminder: {title}"
    heading = "📅 You Have a Meeting Soon"
    host_display = host_email or "Your organizer"
    intro_line = f"<strong>{host_display}</strong> invited you to a meeting that is starting soon."

    guest_emails = _parse_guest_emails(event)
    meet_link = _get_meet_link(event)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
    )
    _dispatch_single_email(guest_email, subject, plain_text, html_body, reply_to=host_email)


# ─── Backward-compat shims (used by existing test endpoint) ──────────────────

def send_calendar_reminder_email(event: dict):
    """Legacy shim: send reminder to host + all guests."""
    send_host_reminder_email(event)
    for g in _parse_guest_emails(event):
        try:
            send_guest_reminder_email(event, g)
        except Exception as exc:
            logger.error("Failed guest reminder to %s: %s", g, exc)


def send_meeting_scheduled_email(event: dict):
    """Legacy shim kept for backward compat — now a no-op (scheduler handles delivery)."""
    logger.info("send_meeting_scheduled_email called (no-op — scheduler handles reminders)")


# ─── Background Scheduler ─────────────────────────────────────────────────────

def process_pending_calendar_reminders():
    """Fetch events where reminder_time <= now AND notification_sent = False, then email host + guests."""
    if not _smtp_is_configured() and not _resend_is_configured():
        logger.warning("Reminders skipped — no email provider configured.")
        return

    conn = get_db_connection()
    if not conn:
        logger.warning("Reminders skipped — DB unavailable.")
        return

    try:
        from core.database import get_db_type
        db_type = get_db_type()
        cursor = get_dict_cursor(conn)
        p = "%s" if db_type == "postgres" else "?"
        now_fn = "NOW()" if db_type == "postgres" else "CURRENT_TIMESTAMP"

        cursor.execute(
            f"""
            SELECT
                calendar_events.id,
                calendar_events.title,
                calendar_events.description,
                calendar_events.category,
                calendar_events.start_time,
                calendar_events.end_time,
                calendar_events.room_id,
                calendar_events.reminder_offset_minutes,
                calendar_events.host_email,
                calendar_events.guest_emails,
                LOWER(TRIM(COALESCE(calendar_events.recipient_email, users.email, ''))) AS fallback_email,
                users.name AS user_name
            FROM calendar_events
            LEFT JOIN users ON users.id = calendar_events.user_id
            WHERE (calendar_events.notification_sent IS NULL OR calendar_events.notification_sent = 0)
              AND calendar_events.reminder_time IS NOT NULL
              AND calendar_events.reminder_time <= {now_fn}
              AND calendar_events.start_time >= ({now_fn} - INTERVAL '30 minutes')
            ORDER BY calendar_events.start_time ASC
            """ if db_type == "postgres" else f"""
            SELECT
                calendar_events.id,
                calendar_events.title,
                calendar_events.description,
                calendar_events.category,
                calendar_events.start_time,
                calendar_events.end_time,
                calendar_events.room_id,
                calendar_events.reminder_offset_minutes,
                calendar_events.host_email,
                calendar_events.guest_emails,
                LOWER(TRIM(COALESCE(calendar_events.recipient_email, users.email, ''))) AS fallback_email,
                users.name AS user_name
            FROM calendar_events
            LEFT JOIN users ON users.id = calendar_events.user_id
            WHERE (calendar_events.notification_sent IS NULL OR calendar_events.notification_sent = 0)
              AND calendar_events.reminder_time IS NOT NULL
              AND calendar_events.reminder_time <= CURRENT_TIMESTAMP
              AND calendar_events.start_time >= datetime(CURRENT_TIMESTAMP, '-30 minutes')
            ORDER BY calendar_events.start_time ASC
            """
        )

        pending = cursor.fetchall()
        logger.info("Reminder worker: %d event(s) due.", len(pending))

        for row in pending:
            event = dict(row)

            # Resolve host_email: prefer dedicated column, fall back to first recipient
            host_email = (event.get("host_email") or "").strip()
            if not host_email:
                fallback = event.get("fallback_email") or ""
                parts = [e.strip() for e in fallback.split(",") if e.strip()]
                host_email = parts[0] if parts else ""
                event["host_email"] = host_email

            # Resolve guest_emails if missing
            if not event.get("guest_emails"):
                fallback = event.get("fallback_email") or ""
                parts = [e.strip() for e in fallback.split(",") if e.strip()]
                guest_list = parts[1:] if len(parts) > 1 else []
                event["guest_emails"] = json.dumps(guest_list)

            try:
                # Send to host
                if host_email:
                    send_host_reminder_email(event)

                # Send to each guest
                for g in _parse_guest_emails(event):
                    try:
                        send_guest_reminder_email(event, g)
                    except Exception as guest_exc:
                        logger.error("Guest reminder failed for %s on event %s: %s", g, event["id"], guest_exc)

                # Mark notification_sent = 1
                now_col = "NOW()" if db_type == "postgres" else "CURRENT_TIMESTAMP"
                cursor.execute(
                    f"UPDATE calendar_events SET notification_sent = 1, reminder_sent_at = {now_col} WHERE id = {p}",
                    (event["id"],),
                )
                conn.commit()
                logger.info("Reminder sent and marked for event %s", event["id"])

            except Exception as exc:
                conn.rollback()
                logger.exception("Failed to send reminder for event %s: %s", event.get("id"), exc)

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.exception("Reminder processing error: %s", exc)
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
    logger.info("Calendar reminder worker started (poll every %ds).", REMINDER_POLL_INTERVAL_SECONDS)


def stop_calendar_reminder_worker():
    _stop_event.set()
    logger.info("Calendar reminder worker stopped.")
