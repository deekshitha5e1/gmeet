import sys
import os
import json
import logging

logging.basicConfig(level=logging.INFO)
from datetime import datetime, timedelta

# Add the backend directory to path
sys.path.append(os.path.join(os.getcwd(), "shnoor-meetings-backend"))

from core.reminders import send_meeting_scheduled_email

# Mock event with multiple recipients
test_event = {
    "id": "manual-test-multi",
    "title": "Organizer & Guest Test",
    "description": "Testing if both host and guests receive the mail.",
    "category": "meetings",
    "start_time": datetime.utcnow() + timedelta(hours=1),
    "end_time": datetime.utcnow() + timedelta(hours=2),
    "room_id": "test-room-123",
    "user_name": "Deekshitha",
    "host_email": "deekshithapasham939@gmail.com",
    "guest_emails": json.dumps(["pashamdeekshitha0@gmail.com"]),
    "participant_emails": json.dumps(["sindhujareeddy@gmail.com"]),
    "reminder_offset_minutes": 60
}

print("Attempting to send multi-recipient test email...")
try:
    send_meeting_scheduled_email(test_event)
    print("Success! Multi-recipient email process completed.")
except Exception as e:
    print(f"Failed to send email: {e}")
