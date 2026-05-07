import json
import logging
import os
import smtplib
import socket
import threading
import urllib.request
import urllib.error
from urllib.parse import urlencode
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.database import get_db_connection, get_dict_cursor, release_db_connection

logger = logging.getLogger(__name__)

DEFAULT_REMINDER_OFFSET_MINUTES = int((os.getenv("CALENDAR_REMINDER_OFFSET_MINUTES") or "10").strip() or "10")
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
            
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
            
        ist_tz = timezone(timedelta(hours=5, minutes=30), name="IST")
        dt_ist = dt.astimezone(ist_tz)
        
        return dt_ist.strftime("%B %d, %Y at %I:%M %p IST")
    except Exception:
        return str(value)


def _get_meet_link(event: dict, role: str = "participant", email: str = "") -> str:
    room_id = event.get("room_id")
    if not room_id:
        return ""
    frontend_url = (os.getenv("FRONTEND_URL") or FRONTEND_URL).rstrip("/")
    query = {"role": role}
    if email:
        query["email"] = email.strip().lower()
    return f"{frontend_url}/meeting/{room_id}?{urlencode(query)}"


def _parse_email_list(raw) -> list:
    """Parse a field (JSON string, list, or comma-sep) into a list of emails."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [e.strip() for e in raw if e and e.strip()]
    try:
        if isinstance(raw, str):
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
    participant_emails: list,
    description: str,
    meet_link: str,
    reminder_mins: int,
    category: str = "Meeting",
) -> tuple:
    """Returns (plain_text, html_string)."""
    start_str = _format_dt(start_time)
    end_str = _format_dt(end_time) if end_time else None
    time_range = start_str + (f" → {end_str}" if end_str else "")

    display_category = "Meeting"
    if category.lower() in ["reminder", "reminders", "task"]:
        display_category = "Task"

    # Plain text
    plain_parts = [heading, "", intro_line, "",
                   f"📅 {title}", f"🕐 {time_range}"]
    if host_email:
        plain_parts.append(f"👤 Organizer: {host_email}")
    if guest_emails:
        plain_parts.append(f"👥 Guests: {', '.join(guest_emails)}")
    if participant_emails:
        plain_parts.append(f"👥 Participants: {', '.join(participant_emails)}")
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
        g_tags = "".join(
            f'<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;'
            f'border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:13px;">{g}</span>'
            for g in guest_emails
        )
        guest_html = f"""
        <tr>
          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;">Guests</td>
          <td style="padding:6px 0;font-size:13px;color:#111827;">{g_tags}</td>
        </tr>"""

    # Participant tags
    participant_html = ""
    if participant_emails:
        p_tags = "".join(
            f'<span style="display:inline-block;background:#F0FDF4;color:#166534;border:1px solid #BBF7D0;'
            f'border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:13px;">{p}</span>'
            for p in participant_emails
        )
        participant_html = f"""
        <tr>
          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;">Participants</td>
          <td style="padding:6px 0;font-size:13px;color:#111827;">{p_tags}</td>
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
        btn_text = "View Task Details" if display_category == "Task" else "Join Meeting Now"
        btn_html = f"""
        <div style="text-align:center;margin:32px 0 20px;">
          <a href="{meet_link}"
             style="background:#2563EB;color:#ffffff;text-decoration:none;padding:14px 40px;
                    border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.5px;
                    display:inline-block;box-shadow:0 4px 14px rgba(37,99,235,0.35);">
            ▶&nbsp; {btn_text}
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
                    <span style="background:#ECFDF5;color:#059669;border-radius:999px;padding:2px 10px;font-weight:600;">{display_category}</span>
                  </td>
                </tr>
                {host_html}
                {guest_html}
                {participant_html}
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

def _send_via_smtp(to_emails: list, subject: str, plain_text: str, html_body: str, reply_to: str = "", individual_recipient: str = ""):
    settings = _get_smtp_settings()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings['from_name']} <{settings['from_email']}>"
    msg["To"] = ", ".join(to_emails)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # Determine who actually receives this physical email
    recipients = [individual_recipient] if individual_recipient else to_emails

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
                # Use sendmail to control exactly who gets it while keeping the "To" header intact
                server.sendmail(settings["from_email"], recipients, msg.as_string())
                logger.info("Email sent via SMTP port %d to %s", port, recipients)
                return
        except Exception as e:
            logger.warning(f"SMTP attempt failed on port {port}: {e}")
            errors.append(f"Port {port}: {e}")
    logger.error(f"All SMTP attempts failed for {recipients}: {'; '.join(errors)}")
    raise RuntimeError(f"All SMTP attempts failed: {'; '.join(errors)}")


def _send_via_resend(to_emails: list, subject: str, plain_text: str, html_body: str, reply_to: str = "", individual_recipient: str = ""):
    settings = _get_resend_settings()
    # For Resend, if individual_recipient is provided, we only send to them in the API call
    # but they will see everyone in the "To" list (if Resend supports multiple in 'to' and we only send 1)
    # Actually, Resend delivers to everyone in the 'to' list. 
    # To send individual emails with shared headers, we'd need to use 'to' for the recipient and 'cc' or just a custom header.
    # But for now, let's keep it simple for Resend.
    payload = {
        "from": f"{settings['from_name']} <{settings['from_email']}>",
        "to": [individual_recipient] if individual_recipient else to_emails,
        "subject": subject,
        "text": plain_text,
        "html": html_body,
    }
    # Note: Resend doesn't easily support "To header is X but deliver to Y" in a single call.
    # So for Resend we'll just send to everyone at once or one by one.
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


def _dispatch_group_email(to_emails: list, subject: str, plain_text: str, html_body: str, reply_to: str = "", individual_recipient: str = ""):
    """Send email to multiple recipients (or one in a group thread) via Resend or SMTP."""
    if not to_emails and not individual_recipient:
        return
    
    target = individual_recipient if individual_recipient else f"{len(to_emails)} recipients"
    logger.info("Dispatching email to=%s subject='%s'", target, subject)
    
    resend_error = None
    if _resend_is_configured():
        try:
            _send_via_resend(to_emails, subject, plain_text, html_body, reply_to, individual_recipient)
            return
        except Exception as resend_err:
            resend_error = str(resend_err)
            logger.warning(f"Resend failed: {resend_err}. Falling back to SMTP.")

    if _smtp_is_configured():
        try:
            _send_via_smtp(to_emails, subject, plain_text, html_body, reply_to, individual_recipient)
            return
        except Exception as smtp_err:
            smtp_error = str(smtp_err)
            error_msg = f"All email providers failed. SMTP Error: {smtp_error}"
            if resend_error:
                error_msg += f" | Resend Error: {resend_error}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)

    raise RuntimeError(
        f"No email provider configured. Missing SMTP: {_get_missing_smtp_keys()}; Missing Resend: {_get_missing_resend_keys()}"
    )


def _dispatch_single_email(to_email: str, subject: str, plain_text: str, html_body: str, reply_to: str = ""):
    """Backward compat shim."""
    _dispatch_group_email([to_email], subject, plain_text, html_body, reply_to)


# ─── Public Email Senders ─────────────────────────────────────────────────────

def send_host_reminder_email(event: dict):
    """Send reminder email to the HOST of the meeting."""
    host_email = (event.get("host_email") or "").strip()
    if not host_email:
        logger.warning("send_host_reminder_email: no host_email for event %s", event.get("id"))
        return

    title = event.get("title") or "Untitled"
    category = event.get("category", "").lower()
    is_task = category in ["task", "reminder", "reminders"]
    category_label = "Task" if is_task else "Meeting"

    subject = f"✅ {category_label} Reminder: {title}"
    heading = f"⏰ {category_label} Reminder"
    intro_line = f"Hi, your {category_label.lower()} <strong>{title}</strong> is starting soon. Here are the details:"

    guest_emails = _parse_email_list(event.get("guest_emails"))
    participant_emails = _parse_email_list(event.get("participant_emails"))
    meet_link = _get_meet_link(event, role="host", email=host_email)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        participant_emails=participant_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
        category=event.get("category") or "meetings",
    )
    _dispatch_single_email(host_email, subject, plain_text, html_body, reply_to="")


def send_guest_reminder_email(event: dict, guest_email: str):
    """Send reminder/invitation email to one GUEST participant."""
    host_email = (event.get("host_email") or "").strip()
    guest_email = guest_email.strip()
    if not guest_email:
        return

    title = event.get("title") or "Untitled"
    category = event.get("category", "").lower()
    is_task = category in ["task", "reminder", "reminders"]
    category_label = "Task" if is_task else "Meeting"

    subject = f"📅 {category_label} Reminder: {title}"
    heading = f"📅 You Have a {category_label} Soon"
    host_display = host_email or "Your organizer"
    intro_line = f"<strong>{host_display}</strong> invited you to a {category_label.lower()} that is starting soon."

    guest_emails = _parse_email_list(event.get("guest_emails"))
    participant_emails = _parse_email_list(event.get("participant_emails"))
    meet_link = _get_meet_link(event, role="participant", email=guest_email)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        participant_emails=participant_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
        category=event.get("category") or "meetings",
    )
    _dispatch_single_email(guest_email, subject, plain_text, html_body, reply_to=host_email)


# ─── Backward-compat shims (used by existing test endpoint) ──────────────────

def send_calendar_reminder_email(event: dict):
    """Legacy shim: send reminder to host + all guests + all participants."""
    logger.info("send_calendar_reminder_email (legacy) triggering send_invitation_emails")
    send_invitation_emails(event)


def send_host_invitation_email(event: dict):
    """Send immediate invitation/confirmation email to the HOST."""
    host_email = (event.get("host_email") or "").strip()
    if not host_email:
        return

    title = event.get("title") or "Untitled Meeting"
    subject = f"📅 Meeting Scheduled: {title}"
    heading = "📅 Meeting Scheduled"
    intro_line = f"You have successfully scheduled the meeting <strong>{title}</strong>. Here are the details:"

    guest_emails = _parse_email_list(event.get("guest_emails"))
    participant_emails = _parse_email_list(event.get("participant_emails"))
    meet_link = _get_meet_link(event, role="host", email=host_email)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        participant_emails=participant_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
        category=event.get("category") or "meetings",
    )
    _dispatch_single_email(host_email, subject, plain_text, html_body, reply_to="")


def send_guest_invitation_email(event: dict, guest_email: str):
    """Send immediate invitation email to one GUEST or PARTICIPANT."""
    host_email = (event.get("host_email") or "").strip()
    guest_email = guest_email.strip()
    if not guest_email:
        return

    title = event.get("title") or "Untitled Meeting"
    subject = f"📩 Invitation: {title}"
    heading = "📩 New Meeting Invitation"
    host_display = host_email or "An organizer"
    intro_line = f"<strong>{host_display}</strong> has invited you to a meeting."

    guest_emails = _parse_email_list(event.get("guest_emails"))
    participant_emails = _parse_email_list(event.get("participant_emails"))
    meet_link = _get_meet_link(event, role="participant", email=guest_email)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        participant_emails=participant_emails,
        description=event.get("description") or "",
        meet_link=meet_link,
        reminder_mins=reminder_mins,
        category=event.get("category") or "meetings",
    )
    _dispatch_single_email(guest_email, subject, plain_text, html_body, reply_to=host_email)


def send_invitation_emails(event: dict):
    """Send a SINGLE group invitation email to host, guests, and participants."""
    logger.info("Sending group invitation email for event %s", event.get("id"))
    
    host_email = (event.get("host_email") or "").strip()
    guest_emails = _parse_email_list(event.get("guest_emails"))
    participant_emails = _parse_email_list(event.get("participant_emails"))
    
    # Collect all unique recipients
    all_recipients = []
    if host_email:
        all_recipients.append(host_email)
    for email in guest_emails + participant_emails:
        if email not in all_recipients:
            all_recipients.append(email)
            
    if not all_recipients:
        logger.warning("No recipients found for invitation email.")
        return

    title = event.get("title") or "Untitled"
    category = event.get("category", "").lower()
    is_task = category in ["task", "reminder", "reminders"]
    category_label = "Task" if is_task else "Meeting"

    subject = f"📅 Invitation: {title}"
    heading = f"📩 New {category_label} Invitation"
    
    host_display = host_email or "An organizer"
    intro_line = f"<strong>{host_display}</strong> has invited you to a {category_label.lower()}."
    if len(all_recipients) > 1:
        intro_line = f"You are invited to a {category_label.lower()} scheduled by <strong>{host_display}</strong>."

    host_meet_link = _get_meet_link(event, role="host", email=host_email)
    reminder_mins = event.get("reminder_offset_minutes") or DEFAULT_REMINDER_OFFSET_MINUTES

    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=event.get("start_time"),
        end_time=event.get("end_time"),
        host_email=host_email,
        guest_emails=guest_emails,
        participant_emails=participant_emails,
        description=event.get("description") or "",
        meet_link=host_meet_link,
        reminder_mins=reminder_mins,
        category=event.get("category") or "meetings",
    )
    
    try:
        # We send an INDIVIDUAL physical email to every person in the list
        # but the "To" header in each email lists everyone.
        # This is more reliable for bypassing spam filters than one bulk email.
        for recipient in all_recipients:
            try:
                # Generate a personalized role-aware link for this specific recipient.
                is_host_recipient = host_email and recipient.strip().lower() == host_email.strip().lower()
                personalized_link = _get_meet_link(
                    event,
                    role="host" if is_host_recipient else "participant",
                    email=recipient,
                )
                
                # Re-build the HTML with the personalized link
                p_plain_text, p_html = _build_email_html(
                    title=title,
                    heading=heading,
                    intro_line=intro_line,
                    start_time=event.get("start_time"),
                    end_time=event.get("end_time"),
                    host_email=host_email,
                    guest_emails=guest_emails,
                    participant_emails=participant_emails,
                    description=event.get("description") or "",
                    meet_link=personalized_link,
                    reminder_mins=reminder_mins,
                    category=event.get("category") or "meetings",
                )
                
                _dispatch_group_email(all_recipients, subject, p_plain_text, p_html, reply_to=host_email, individual_recipient=recipient)
            except Exception as individual_exc:
                logger.error("Failed to send invitation email to %s: %s", recipient, individual_exc)
    except Exception as exc:
        logger.error("Failed to send group invitation emails: %s", exc)


def send_meeting_scheduled_email(event: dict):
    """Legacy shim kept for backward compat — now triggers immediate invitations."""
    logger.info("send_meeting_scheduled_email (legacy) triggering send_invitation_emails")
    send_invitation_emails(event)


def send_room_invitation_email(room_id: str, guest_email: str, host_name: str = "", host_email: str = ""):
    """Send a premium invitation email for a live meeting room."""
    title = f"Live Meeting: {room_id[:8]}"
    subject = "📩 Invitation: Shnoor Meeting"
    heading = "📩 Live Meeting Invitation"
    host_display = (host_name or host_email or "An organizer").strip()
    intro_line = f"<strong>{host_display}</strong> has invited you to join a live meeting on Shnoor Meetings."
    
    frontend_url = (os.getenv("FRONTEND_URL") or FRONTEND_URL).rstrip("/")
    meet_link = f"{frontend_url}/meeting/{room_id}?role=participant&email={guest_email}"
    
    plain_text, html_body = _build_email_html(
        title=title,
        heading=heading,
        intro_line=intro_line,
        start_time=None,  # Live meetings don't always have a start time in this context
        end_time=None,
        host_email=host_email,
        guest_emails=[],
        participant_emails=[guest_email],
        description="This is a live meeting invitation. You can join the room immediately by clicking the button below.",
        meet_link=meet_link,
        reminder_mins=0,
        category="meetings"
    )
    
    _dispatch_single_email(guest_email, subject, plain_text, html_body, reply_to=host_email)


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
                calendar_events.participant_emails,
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
                calendar_events.participant_emails,
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

            # Resolve participant_emails if missing
            if not event.get("participant_emails"):
                event["participant_emails"] = "[]"

            try:
                # Send to host
                if host_email:
                    send_host_reminder_email(event)

                # Send to each guest
                for g in _parse_email_list(event.get("guest_emails")):
                    try:
                        send_guest_reminder_email(event, g)
                    except Exception as guest_exc:
                        logger.error("Guest reminder failed for %s on event %s: %s", g, event["id"], guest_exc)

                # Send to each participant
                for p in _parse_email_list(event.get("participant_emails")):
                    try:
                        send_guest_reminder_email(event, p)
                    except Exception as part_exc:
                        logger.error("Participant reminder failed for %s on event %s: %s", p, event["id"], part_exc)

                # Mark notification_sent = 1
                now_col = "NOW()" if db_type == "postgres" else "CURRENT_TIMESTAMP"
                p_mark = "%s" if db_type == "postgres" else "?"
                cursor.execute(
                    f"UPDATE calendar_events SET notification_sent = 1, reminder_sent_at = {now_col} WHERE id = {p_mark}",
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
