import sys
import os
from datetime import datetime

# Add the backend directory to path
sys.path.append(os.path.join(os.getcwd(), "shnoor-meetings-backend"))

from core.database import init_db, get_db_connection, get_dict_cursor, release_db_connection
from core.reminders import send_meeting_scheduled_email

def debug_dispatch(event_id):
    init_db()
    conn = get_db_connection()
    try:
        cursor = get_dict_cursor(conn)
        cursor.execute("SELECT * FROM calendar_events WHERE id = %s", (event_id,))
        row = cursor.fetchone()
        if not row:
            print(f"Event {event_id} not found")
            return
        
        event = dict(row)
        # Add user_name which might be missing in DB but expected by email builder
        event["user_name"] = "Organizer"
        # Mock the recipient_email as user_email
        event["user_email"] = event["recipient_email"]
        
        print(f"Attempting to dispatch email for Event: {event['title']}")
        print(f"Recipients: {event['user_email']}")
        
        send_meeting_scheduled_email(event)
        print("SUCCESS!")
    except Exception as e:
        print(f"FAILED: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if 'conn' in locals() and conn:
            release_db_connection(conn)

if __name__ == "__main__":
    # Using the last event ID from the previous check
    debug_dispatch("e5c95153-eaf6-4d18-a857-8a95ea67db96")
