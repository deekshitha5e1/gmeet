import os
import sys
from dotenv import load_dotenv

# Add the backend directory to the path so we can import core.reminders
sys.path.append(os.path.abspath('shnoor-meetings-backend'))

from core.reminders import send_meeting_scheduled_email

load_dotenv('shnoor-meetings-backend/.env')

test_event = {
    "id": "test-id",
    "title": "Test Deployment Meeting",
    "description": "Checking if email works from local environment",
    "category": "test",
    "start_time": "2026-05-03T14:00:00Z",
    "end_time": "2026-05-03T15:00:00Z",
    "room_id": "test-room",
    "user_email": "deekshithapasham939@gmail.com", # Sending to the same email for testing
    "user_name": "Test User"
}

print("Attempting to send test email...")
try:
    send_meeting_scheduled_email(test_event)
    print("Success! Email sent.")
except Exception as e:
    print(f"Failed to send email: {e}")
