import os
import uuid
import logging
import sqlite3
import threading
from typing import Optional, Union, Dict, Any
from dotenv import load_dotenv

# Optional psycopg2 support
try:
    import psycopg2
    from psycopg2.pool import ThreadedConnectionPool
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

load_dotenv()

logger = logging.getLogger(__name__)

# Global connection pool or SQLite path
_db_pool = None
_sqlite_path = None
_db_type = "postgres"  # or "sqlite"

def get_db_type():
    return _db_type

def normalize_uuid_or_none(val):
    if not val: return None
    try:
        return str(uuid.UUID(str(val)))
    except ValueError:
        # If it's not a valid UUID, return it as a string anyway if it's not empty
        return str(val)

def generate_stable_uuid(*args):
    import hashlib
    seed = ":".join(str(arg) for arg in args)
    return str(uuid.UUID(hashlib.md5(seed.encode("utf-8")).hexdigest()))

def _build_connection_dsn() -> Optional[str]:
    # Priority 1: SUPABASE_DB_URL or DATABASE_URL (URIs)
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if url:
        if "sslmode=" not in url and "postgresql" in url:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}sslmode=require"
        return url

    # Priority 2: Individual POSTGRES_* variables
    host = os.getenv("POSTGRES_HOST")
    if host:
        import urllib.parse
        user = os.getenv("POSTGRES_USER", "postgres")
        password = os.getenv("POSTGRES_PASSWORD", "")
        if "%" in password:
            password = urllib.parse.unquote(password)
        
        port = os.getenv("POSTGRES_PORT", "5432")
        dbname = os.getenv("POSTGRES_DB", "postgres")
        return f"host={host} port={port} user={user} password={password} dbname={dbname} sslmode=require"

    return None

def init_db():
    global _db_pool, _sqlite_path, _db_type
    
    # Try PostgreSQL first
    if HAS_PSYCOPG2:
        dsn = _build_connection_dsn()
        if dsn:
            try:
                _db_pool = ThreadedConnectionPool(1, 20, dsn=dsn)
                _db_type = "postgres"
                # Test connection
                conn = _db_pool.getconn()
                _db_pool.putconn(conn)
                _ensure_tables()
                logger.info("PostgreSQL connection pool initialized successfully.")
                return
            except Exception as e:
                logger.error(f"PostgreSQL initialization failed: {e}", exc_info=True)
                if dsn and ("supabase.com" in dsn or "supabase.co" in dsn):
                    # Try direct fallback with correct Supabase pattern: db.<project>.supabase.co
                    try:
                        import re
                        # Extract project ID from the user part (postgres.<project>) or the host
                        project_id = None
                        match = re.search(r"postgres\.([a-z0-9]+)", dsn)
                        if match:
                            project_id = match.group(1)
                        else:
                            match = re.search(r"([a-z0-9]+)\.pooler\.supabase\.com", dsn)
                            if match:
                                project_id = match.group(1)
                        
                        if project_id:
                            # Build direct DSN
                            # 1. Try .co (most common for Supabase DB)
                            direct_dsn_co = dsn.replace(":6543", ":5432")
                            host_pattern = r"@[^:]+:"
                            direct_dsn_co = re.sub(host_pattern, f"@db.{project_id}.supabase.co:", direct_dsn_co)
                            
                            logger.info(f"Attempting PostgreSQL direct fallback to: db.{project_id}.supabase.co")
                            try:
                                _db_pool = ThreadedConnectionPool(1, 10, dsn=direct_dsn_co)
                                _db_type = "postgres"
                                _ensure_tables()
                                logger.info("Connected via PostgreSQL direct fallback (.co).")
                                return
                            except Exception as co_err:
                                logger.warning(f"Fallback to .co failed: {co_err}")
                                
                                # 2. Try .com (alternative)
                                direct_dsn_com = direct_dsn_co.replace(".supabase.co:", ".supabase.com:")
                                logger.info(f"Attempting PostgreSQL direct fallback to: db.{project_id}.supabase.com")
                                _db_pool = ThreadedConnectionPool(1, 10, dsn=direct_dsn_com)
                                _db_type = "postgres"
                                _ensure_tables()
                                logger.info("Connected via PostgreSQL direct fallback (.com).")
                                return
                    except Exception as fe:
                        logger.error(f"PostgreSQL direct fallback failed: {fe}", exc_info=True)

    # Fallback to SQLite
    logger.info("Falling back to local SQLite database.")
    _db_type = "sqlite"
    # Create the database in the backend root directory
    _sqlite_path = os.path.join(os.getcwd(), "shnoor_meetings.db")
    _ensure_tables()
    logger.info(f"SQLite initialized at {_sqlite_path}")

def get_db_connection():
    if _db_type == "postgres" and _db_pool:
        try:
            return _db_pool.getconn()
        except Exception:
            return None
    elif _db_type == "sqlite":
        try:
            conn = sqlite3.connect(_sqlite_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception:
            return None
    return None

def release_db_connection(conn):
    if not conn:
        return
    if _db_type == "postgres" and _db_pool:
        _db_pool.putconn(conn)
    elif _db_type == "sqlite":
        conn.close()

def get_dict_cursor(conn):
    if _db_type == "postgres":
        return conn.cursor(cursor_factory=RealDictCursor)
    return conn.cursor()

def _ensure_tables():
    conn = get_db_connection()
    if not conn:
        return

    try:
        cursor = get_dict_cursor(conn)
        
        # SQLite compatible types
        uuid_type = "UUID" if _db_type == "postgres" else "TEXT"
        now_func = "NOW()" if _db_type == "postgres" else "CURRENT_TIMESTAMP"
        
        # Users Table
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS users (
                id {uuid_type} PRIMARY KEY,
                firebase_uid TEXT UNIQUE,
                name TEXT,
                email TEXT UNIQUE,
                profile_picture TEXT,
                created_at TIMESTAMPTZ DEFAULT {now_func}
            )
        """)

        # Meetings Table
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS meetings (
                id {uuid_type} PRIMARY KEY,
                host_id {uuid_type} REFERENCES users(id),
                title TEXT,
                status TEXT DEFAULT 'inactive',
                started_at TIMESTAMPTZ,
                ended_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT {now_func}
            )
        """)

        # Calendar Events Table
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS calendar_events (
                id {uuid_type} PRIMARY KEY,
                user_id {uuid_type} REFERENCES users(id),
                recipient_email TEXT,
                title TEXT NOT NULL,
                description TEXT,
                start_time TIMESTAMPTZ NOT NULL,
                end_time TIMESTAMPTZ,
                category TEXT DEFAULT 'meetings',
                room_id {uuid_type},
                reminder_offset_minutes INTEGER DEFAULT 5,
                reminder_sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT {now_func}
            )
        """)
        
        # Participants Table (MISSING BEFORE)
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS participants (
                id {uuid_type} PRIMARY KEY,
                meeting_id {uuid_type} REFERENCES meetings(id),
                user_id {uuid_type} REFERENCES users(id),
                role TEXT DEFAULT 'participant',
                joined_at TIMESTAMPTZ DEFAULT {now_func},
                left_at TIMESTAMPTZ
            )
        """)

        # Meeting Chats Table (MISSING BEFORE)
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS meeting_chats (
                id {uuid_type} PRIMARY KEY,
                meeting_id {uuid_type} REFERENCES meetings(id),
                sender_id {uuid_type} REFERENCES users(id),
                message TEXT NOT NULL,
                sent_at TIMESTAMPTZ DEFAULT {now_func}
            )
        """)

        # Column patches
        if _db_type == "postgres":
            for col in [("recipient_email", "TEXT"), ("end_time", "TIMESTAMPTZ"), ("description", "TEXT")]:
                cursor.execute(f"""
                    DO $$ BEGIN 
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='{col[0]}') THEN
                            ALTER TABLE calendar_events ADD COLUMN {col[0]} {col[1]};
                        END IF;
                    END $$;
                """)
        else:
            # SQLite doesn't have DO blocks, we check manually
            for col_name in ["user_id", "recipient_email", "end_time", "description", "reminder_offset_minutes", "reminder_sent_at"]:
                cursor.execute(f"PRAGMA table_info(calendar_events)")
                cols = [row[1] for row in cursor.fetchall()]
                if col_name not in cols:
                    col_type = "INTEGER" if col_name == "reminder_offset_minutes" else "TEXT"
                    cursor.execute(f"ALTER TABLE calendar_events ADD COLUMN {col_name} {col_type}")

        conn.commit()
    except Exception as e:
        logger.error(f"Error ensuring tables exist: {e}", exc_info=True)
        conn.rollback()
    finally:
        release_db_connection(conn)

def get_or_create_user(user_id=None, firebase_uid=None, name=None, email=None, profile_picture=None):
    conn = get_db_connection()
    if not conn: return None
    try:
        cursor = get_dict_cursor(conn)
        user = None
        p = "%s" if _db_type == "postgres" else "?"
        
        if user_id:
            cursor.execute(f"SELECT * FROM users WHERE id = {p}", (str(user_id),))
            user = cursor.fetchone()
        elif firebase_uid:
            cursor.execute(f"SELECT * FROM users WHERE firebase_uid = {p}", (firebase_uid,))
            user = cursor.fetchone()
        elif email:
            cursor.execute(f"SELECT * FROM users WHERE email = {p}", (email.strip().lower(),))
            user = cursor.fetchone()

        if user: return dict(user)

        new_id = str(user_id or uuid.uuid4())
        placeholders = "%s, %s, %s, %s, %s" if _db_type == 'postgres' else "?, ?, ?, ?, ?"
        cursor.execute(f"""
            INSERT INTO users (id, firebase_uid, name, email, profile_picture)
            VALUES ({placeholders})
        """, (new_id, firebase_uid, name, email.strip().lower() if email else None, profile_picture))
        conn.commit()
        return {"id": new_id, "firebase_uid": firebase_uid, "name": name, "email": email, "profile_picture": profile_picture}
    finally:
        release_db_connection(conn)

def ensure_meeting_record(meeting_id, host_user_id=None, title=None, status=None, started_at=None, ended_at=None):
    mid = normalize_uuid_or_none(meeting_id)
    if not mid: return None
    conn = get_db_connection()
    if not conn: return None
    try:
        cursor = get_dict_cursor(conn)
        p = "%s" if _db_type == "postgres" else "?"
        cursor.execute(f"SELECT * FROM meetings WHERE id = {p}", (mid,))
        existing = cursor.fetchone()

        if existing:
            if _db_type == "postgres":
                cursor.execute("""
                    UPDATE meetings
                    SET host_id = COALESCE(%s, host_id),
                        title = COALESCE(%s, title),
                        status = COALESCE(%s, status),
                        started_at = COALESCE(%s, started_at),
                        ended_at = COALESCE(%s, ended_at)
                    WHERE id = %s
                """, (host_user_id, title, status, started_at, ended_at, mid))
            else:
                cursor.execute("""
                    UPDATE meetings
                    SET host_id = IFNULL(?, host_id),
                        title = IFNULL(?, title),
                        status = IFNULL(?, status),
                        started_at = IFNULL(?, started_at),
                        ended_at = IFNULL(?, ended_at)
                    WHERE id = ?
                """, (host_user_id, title, status, started_at, ended_at, mid))
            conn.commit()
            return mid

        placeholders = "%s, %s, %s, %s, %s, %s" if _db_type == "postgres" else "?, ?, ?, ?, ?, ?"
        cursor.execute(f"""
            INSERT INTO meetings (id, host_id, title, status, started_at, ended_at)
            VALUES ({placeholders})
        """, (mid, host_user_id, title, status or "inactive", started_at, ended_at))
        conn.commit()
        return mid
    finally:
        release_db_connection(conn)

def get_meeting_record(meeting_id):
    mid = normalize_uuid_or_none(meeting_id)
    if not mid: return None
    conn = get_db_connection()
    if not conn: return None
    try:
        cursor = get_dict_cursor(conn)
        p = "%s" if _db_type == "postgres" else "?"
        cursor.execute(f"""
            SELECT meetings.*, users.email AS host_email, users.name AS host_name
            FROM meetings
            LEFT JOIN users ON users.id = meetings.host_id
            WHERE meetings.id = {p}
        """, (mid,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        release_db_connection(conn)

def update_meeting_activity(meeting_id):
    mid = normalize_uuid_or_none(meeting_id)
    if not mid: return
    conn = get_db_connection()
    if not conn: return
    try:
        cursor = get_dict_cursor(conn)
        p = "%s" if _db_type == "postgres" else "?"
        cursor.execute(f"SELECT COUNT(*) AS active_count FROM participants WHERE meeting_id = {p} AND left_at IS NULL", (mid,))
        active_count = cursor.fetchone()[0] if _db_type == "sqlite" else cursor.fetchone()["active_count"]

        now_val = "NOW()" if _db_type == "postgres" else "CURRENT_TIMESTAMP"
        if active_count > 0:
            cursor.execute(f"""
                UPDATE meetings
                SET status = 'active',
                    started_at = COALESCE(started_at, {now_val}),
                    ended_at = NULL
                WHERE id = {p}
            """, (mid,))
        else:
            cursor.execute(f"""
                UPDATE meetings
                SET status = 'inactive',
                    ended_at = {now_val}
                WHERE id = {p}
            """, (mid,))
        conn.commit()
    finally:
        release_db_connection(conn)

def upsert_participant_record(meeting_id, user_id, role="participant", joined_at=None):
    mid = normalize_uuid_or_none(meeting_id)
    uid = normalize_uuid_or_none(user_id)
    if not mid or not uid: return None
    
    participant_id = generate_stable_uuid("participant", mid, uid)
    role_name = (role or "participant").strip().lower()
    
    conn = get_db_connection()
    if not conn: return None
    try:
        cursor = get_dict_cursor(conn)
        now_val = "NOW()" if _db_type == "postgres" else "CURRENT_TIMESTAMP"
        
        if _db_type == "postgres":
            cursor.execute("""
                INSERT INTO participants (id, meeting_id, user_id, role, joined_at)
                VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, NOW()))
                ON CONFLICT (id)
                DO UPDATE SET
                    role = EXCLUDED.role,
                    joined_at = COALESCE(EXCLUDED.joined_at, participants.joined_at, NOW()),
                    left_at = NULL
            """, (participant_id, mid, uid, role_name, joined_at))
        else:
            # SQLite ON CONFLICT
            cursor.execute("""
                INSERT INTO participants (id, meeting_id, user_id, role, joined_at)
                VALUES (?, ?, ?, ?, IFNULL(?, CURRENT_TIMESTAMP))
                ON CONFLICT (id) DO UPDATE SET
                    role = excluded.role,
                    joined_at = IFNULL(excluded.joined_at, participants.joined_at),
                    left_at = NULL
            """, (participant_id, mid, uid, role_name, joined_at))
            
        conn.commit()
        update_meeting_activity(mid)
        return participant_id
    finally:
        release_db_connection(conn)

def mark_participant_left(meeting_id, user_id):
    mid = normalize_uuid_or_none(meeting_id)
    uid = normalize_uuid_or_none(user_id)
    if not mid or not uid: return
    conn = get_db_connection()
    if not conn: return
    try:
        cursor = get_dict_cursor(conn)
        p = "%s" if _db_type == "postgres" else "?"
        now_val = "NOW()" if _db_type == "postgres" else "CURRENT_TIMESTAMP"
        cursor.execute(f"UPDATE participants SET left_at = {now_val} WHERE meeting_id = {p} AND user_id = {p} AND left_at IS NULL", (mid, uid))
        conn.commit()
        update_meeting_activity(mid)
    finally:
        release_db_connection(conn)

def save_chat_message(meeting_id, sender_id, message, sent_at=None):
    mid = normalize_uuid_or_none(meeting_id)
    sid = normalize_uuid_or_none(sender_id)
    if not mid or not sid or not message: return None
    conn = get_db_connection()
    if not conn: return None
    try:
        chat_id = generate_stable_uuid(mid, sid, message, sent_at or "now")
        cursor = get_dict_cursor(conn)
        p = "%s" if _db_type == "postgres" else "?"
        now_val = "NOW()" if _db_type == "postgres" else "CURRENT_TIMESTAMP"
        cursor.execute(f"""
            INSERT INTO meeting_chats (id, meeting_id, sender_id, message, sent_at)
            VALUES ({p}, {p}, {p}, {p}, COALESCE({p}{'::timestamptz' if _db_type == 'postgres' else ''}, {now_val}))
        """, (chat_id, mid, sid, message, sent_at))
        conn.commit()
        return chat_id
    finally:
        release_db_connection(conn)
