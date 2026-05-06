import sys
import os

# Add the backend directory to path
sys.path.append(os.path.join(os.getcwd(), "shnoor-meetings-backend"))

from core.database import init_db, get_db_connection, get_dict_cursor, release_db_connection

def check_events():
    init_db()
    conn = get_db_connection()
    if not conn:
        print("Failed to connect to DB")
        return
    try:
        cursor = get_dict_cursor(conn)
        cursor.execute("SELECT * FROM calendar_events ORDER BY created_at DESC LIMIT 5")
        rows = cursor.fetchall()
        for row in rows:
            r = dict(row)
            print(f"ID: {r['id']}, Title: {r['title']}, Recipients: {r['recipient_email']}, Created: {r['created_at']}")
    finally:
        release_db_connection(conn)

if __name__ == "__main__":
    check_events()
