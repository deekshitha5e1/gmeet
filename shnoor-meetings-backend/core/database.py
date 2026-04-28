import os
import uuid
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

# We use the Connection Pooling URL from Supabase (Defaults to Port 6543)
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")

# Global connection pool
db_pool = None


def _build_connection_dsn():
    if not SUPABASE_DB_URL:
        return None

    if "sslmode=" in SUPABASE_DB_URL:
        return SUPABASE_DB_URL

    separator = "&" if "?" in SUPABASE_DB_URL else "?"
    return f"{SUPABASE_DB_URL}{separator}sslmode=require"

def init_db():
    """
    Initialize the connection pool. Called from main.py at startup.
    Supabase handles table creation via SQL Editor, so we only setup the pool here.
    """
    global db_pool
    connection_dsn = _build_connection_dsn()

    if connection_dsn:
        try:
            # 1 = max connections, 20 = max connections in the python-level pool
            db_pool = ThreadedConnectionPool(1, 20, dsn=connection_dsn)
            _ensure_tables()
            print("Database connection pool initialized successfully.")
        except Exception as e:
            print(f"Error initializing connection pool: {e}")
    else:
        print("WARNING: SUPABASE_DB_URL environment variable is not set. Database will not connect.")

def get_db_connection():
    """
    Get a connection from the Python connection pool.
    """
    if db_pool:
        try:
            return db_pool.getconn()
        except Exception as e:
            print(f"Failed to get connection from pool: {e}")
            return None
    return None


def get_dict_cursor(conn):
    return conn.cursor(cursor_factory=RealDictCursor)


def is_valid_uuid(value):
    if not value:
        return False

    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def normalize_uuid_or_none(value):
    if is_valid_uuid(value):
        return str(uuid.UUID(str(value)))
    return None


def generate_stable_uuid(*parts):
    seed = ":".join(str(part) for part in parts if part is not None)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def get_or_create_user(user_id=None, firebase_uid=None, name=None, email=None, profile_picture=None):
    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    normalized_user_id = normalize_uuid_or_none(user_id)
    fallback_name = (name or email or "Guest").strip() or "Guest"
    actual_email = (email or "").strip() or None

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            SELECT id
            FROM users
            WHERE (%s IS NOT NULL AND id = %s)
               OR (%s IS NOT NULL AND firebase_uid = %s)
               OR (%s IS NOT NULL AND email = %s)
            ORDER BY created_at ASC NULLS LAST
            LIMIT 1
            """,
            (
                normalized_user_id,
                normalized_user_id,
                firebase_uid,
                firebase_uid,
                actual_email,
                actual_email,
            )
        )
        user = cursor.fetchone()
        if user:
            cursor.execute(
                """
                UPDATE users
                SET firebase_uid = COALESCE(%s, firebase_uid),
                    name = COALESCE(%s, name),
                    email = COALESCE(%s, email),
                    profile_picture = COALESCE(%s, profile_picture)
                WHERE id = %s
                """,
                (firebase_uid, fallback_name, actual_email, profile_picture, user["id"])
            )
            conn.commit()
            return str(user["id"])

        if not normalized_user_id:
            raise ValueError("A frontend-generated user ID is required to create a user record")

        cursor.execute(
            """
            INSERT INTO users (id, firebase_uid, name, email, profile_picture)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (normalized_user_id, firebase_uid, fallback_name, actual_email, profile_picture)
        )
        conn.commit()
        return normalized_user_id
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


def ensure_meeting_record(meeting_id, host_user_id=None, title=None, status=None, started_at=None, ended_at=None):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    if not normalized_meeting_id:
        return None

    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute("SELECT * FROM meetings WHERE id = %s", (normalized_meeting_id,))
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                """
                UPDATE meetings
                SET host_id = COALESCE(%s, host_id),
                    title = COALESCE(%s, title),
                    status = COALESCE(%s, status),
                    started_at = COALESCE(%s, started_at),
                    ended_at = COALESCE(%s, ended_at)
                WHERE id = %s
                """,
                (host_user_id, title, status, started_at, ended_at, normalized_meeting_id)
            )
            conn.commit()
            return normalized_meeting_id

        cursor.execute(
            """
            INSERT INTO meetings (id, host_id, title, status, started_at, ended_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (normalized_meeting_id, host_user_id, title, status or "inactive", started_at, ended_at)
        )
        conn.commit()
        return normalized_meeting_id
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


def get_meeting_record(meeting_id):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    if not normalized_meeting_id:
        return None

    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            SELECT
                meetings.*,
                users.email AS host_email,
                users.name AS host_name
            FROM meetings
            LEFT JOIN users ON users.id = meetings.host_id
            WHERE meetings.id = %s
            """,
            (normalized_meeting_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        release_db_connection(conn)


def update_meeting_activity(meeting_id):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    if not normalized_meeting_id:
        return

    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            SELECT COUNT(*) AS active_count
            FROM participants
            WHERE meeting_id = %s AND left_at IS NULL
            """,
            (normalized_meeting_id,)
        )
        active_count = cursor.fetchone()["active_count"]

        if active_count > 0:
            cursor.execute(
                """
                UPDATE meetings
                SET status = 'active',
                    started_at = COALESCE(started_at, NOW()),
                    ended_at = NULL
                WHERE id = %s
                """,
                (normalized_meeting_id,)
            )
        else:
            cursor.execute(
                """
                UPDATE meetings
                SET status = 'inactive',
                    ended_at = NOW()
                WHERE id = %s
                """,
                (normalized_meeting_id,)
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


def upsert_participant_record(meeting_id, user_id, role="participant", joined_at=None):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    normalized_user_id = normalize_uuid_or_none(user_id)
    if not normalized_meeting_id or not normalized_user_id:
        return None

    participant_id = generate_stable_uuid("participant", normalized_meeting_id, normalized_user_id)
    role_name = (role or "participant").strip().lower()

    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            INSERT INTO participants (id, meeting_id, user_id, role, joined_at)
            VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, NOW()))
            ON CONFLICT (id)
            DO UPDATE SET
                role = EXCLUDED.role,
                joined_at = COALESCE(EXCLUDED.joined_at, participants.joined_at, NOW()),
                left_at = NULL
            """,
            (participant_id, normalized_meeting_id, normalized_user_id, role_name, joined_at)
        )
        conn.commit()
        update_meeting_activity(normalized_meeting_id)
        return participant_id
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


def mark_participant_left(meeting_id, user_id):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    normalized_user_id = normalize_uuid_or_none(user_id)
    if not normalized_meeting_id or not normalized_user_id:
        return

    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = get_dict_cursor(conn)
        cursor.execute(
            """
            UPDATE participants
            SET left_at = NOW()
            WHERE meeting_id = %s AND user_id = %s AND left_at IS NULL
            """,
            (normalized_meeting_id, normalized_user_id)
        )
        conn.commit()
        update_meeting_activity(normalized_meeting_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


def save_chat_message(meeting_id, sender_id, message, sent_at=None):
    normalized_meeting_id = normalize_uuid_or_none(meeting_id)
    normalized_sender_id = normalize_uuid_or_none(sender_id)
    if not normalized_meeting_id or not normalized_sender_id or not message:
        return None

    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection is unavailable")

    try:
        message_timestamp = sent_at or None
        chat_id = generate_stable_uuid(normalized_meeting_id, normalized_sender_id, message, message_timestamp or "now")
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO meeting_chats (id, meeting_id, sender_id, message, sent_at)
                VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, NOW()))
                """,
                (chat_id, normalized_meeting_id, normalized_sender_id, message, message_timestamp)
            )
        conn.commit()
        return chat_id
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)

def release_db_connection(conn):
    """
    Return a connection back to the pool so it can be reused by another request.
    """
    if db_pool and conn:
        db_pool.putconn(conn)


def _ensure_tables():
    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Database connection pool is not available.")

    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)
