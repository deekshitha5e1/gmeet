import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.connection_manager import manager
from core.database import (
    ensure_meeting_record,
    get_meeting_record,
    get_db_connection,
    get_db_type,
    get_dict_cursor,
    get_or_create_user,
    mark_participant_left,
    normalize_uuid_or_none,
    release_db_connection,
    save_chat_message,
    upsert_participant_record,
)

logger = logging.getLogger(__name__)

router = APIRouter()

async def sync_waiting_room(meeting_id: str):
    requests = manager.get_waiting_requests(meeting_id)
    await manager.send_to_host(meeting_id, {
        "type": "waiting-room-sync",
        "requests": requests,
    })

@router.get("/api/meetings/{meeting_id}/waiting-room")
async def get_waiting_room(meeting_id: str):
    return {"requests": manager.get_waiting_requests(meeting_id)}

@router.post("/api/meetings/{meeting_id}/waiting-room/{client_id}/admit")
async def admit_waiting_participant(meeting_id: str, client_id: str):
    manager.remove_waiting_request(meeting_id, client_id)
    manager.add_accepted_participant(meeting_id, client_id)
    await sync_waiting_room(meeting_id)
    await manager.send_to_client(meeting_id, client_id, {
        "type": "accepted",
        "sender": "host",
        "meetingId": meeting_id,
        "admitted": True
    })
    return {"ok": True}

@router.post("/api/meetings/{meeting_id}/waiting-room/{client_id}/deny")
async def deny_waiting_participant(meeting_id: str, client_id: str):
    manager.remove_waiting_request(meeting_id, client_id)
    await sync_waiting_room(meeting_id)
    await manager.send_to_client(meeting_id, client_id, {
        "type": "deny",
        "sender": "host",
        "meetingId": meeting_id
    })
    return {"ok": True}

def is_invited_to_meeting(meeting_id: str, email: str) -> bool:
    """Check if the given email is a host, guest, or participant for the meeting."""
    if not meeting_id or not email:
        return False
    
    email = email.strip().lower()
    conn = get_db_connection()
    if not conn:
        return False
        
    try:
        cursor = get_dict_cursor(conn)
        db_type = get_db_type()
        p = "%s" if db_type == "postgres" else "?"
        
        # Check both the meeting table (for room_id) and the calendar table
        cursor.execute(
            f"""
            SELECT host_email, guest_emails, participant_emails 
            FROM calendar_events 
            WHERE room_id = {p} OR id = {p}
            """,
            (meeting_id, meeting_id)
        )
        row = cursor.fetchone()
        if not row:
            return False
            
        logger.info(f"Checking invitation for {email} in meeting {meeting_id}")
        # Check Host
        if row.get("host_email") and row["host_email"].strip().lower() == email:
            logger.info(f"User {email} is the HOST of {meeting_id}")
            return True
            
        # Check Guests
        guests = row.get("guest_emails")
        if guests:
            try:
                guest_list = json.loads(guests) if isinstance(guests, str) else guests
                if any(g.strip().lower() == email for g in guest_list):
                    logger.info(f"User {email} is an invited GUEST of {meeting_id}")
                    return True
            except Exception as e:
                logger.warning(f"Error parsing guest_emails for {meeting_id}: {e}")
                # Fallback for old comma-separated format
                if any(g.strip().lower() == email for g in str(guests).split(",")):
                    logger.info(f"User {email} (legacy comma-sep) is an invited GUEST of {meeting_id}")
                    return True
                    
        # Check Participants
        participants = row.get("participant_emails")
        if participants:
            try:
                participant_list = json.loads(participants) if isinstance(participants, str) else participants
                if any(p.strip().lower() == email for p in participant_list):
                    logger.info(f"User {email} is an invited PARTICIPANT of {meeting_id}")
                    return True
            except Exception as e:
                logger.warning(f"Error parsing participant_emails for {meeting_id}: {e}")
                
        logger.info(f"User {email} NOT found in invitation list for {meeting_id}")
        return False
    except Exception as e:
        logger.error(f"Error checking invitation for {email} in {meeting_id}: {e}")
        return False
    finally:
        release_db_connection(conn)

def is_host_of_meeting(meeting_id: str, email: str) -> bool:
    """Check whether the email is the organizer for this meeting."""
    if not meeting_id or not email:
        return False

    email = email.strip().lower()
    meeting = get_meeting_record(meeting_id) or {}
    if (meeting.get("host_email") or "").strip().lower() == email:
        return True

    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = get_dict_cursor(conn)
        p = "%s" if get_db_type() == "postgres" else "?"
        cursor.execute(
            f"""
            SELECT host_email
            FROM calendar_events
            WHERE room_id = {p} OR id = {p}
            """,
            (meeting_id, meeting_id)
        )
        row = cursor.fetchone()
        return bool(row and (row.get("host_email") or "").strip().lower() == email)
    except Exception as e:
        logger.error(f"Error checking host email for {meeting_id}: {e}")
        return False
    finally:
        release_db_connection(conn)

@router.websocket("/ws/{meeting_id}/{role_or_id}")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str, role_or_id: str, client_id: str = None, email: str = None):
    """
    WebSocket endpoint for handling signaling.
    Path format: /ws/{meeting_id}/{role}?client_id=...
    Also supports old format: /ws/{meeting_id}/{client_id}
    """
    # Detect if role_or_id is a role or a client_id
    is_explicit_role = role_or_id in ["host", "participant"]
    role = role_or_id if is_explicit_role else "participant"
    normalized_email = (email or "").strip().lower()
    if role == "host" and normalized_email and not is_host_of_meeting(meeting_id, normalized_email):
        logger.warning(
            "Downgrading non-host websocket role for %s in meeting %s",
            normalized_email,
            meeting_id,
        )
        role = "participant"
    
    # Final client ID resolution
    cid = client_id or (role_or_id if not is_explicit_role else None)
    if not cid:
        import uuid
        cid = str(uuid.uuid4())
        
    await manager.connect(websocket, meeting_id, role, cid)
    
    # Auto-admit removed as per user request. 
    # All participants must now be manually admitted by the host.
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            # Allow upgrading to host via message (legacy frontend support)
            if msg_type in ["host_join", "host-ready"]:
                verified_host_email = bool(normalized_email and is_host_of_meeting(meeting_id, normalized_email))
                if role != "host" and not verified_host_email:
                    logger.warning(
                        "Ignoring host promotion for non-host client %s in meeting %s",
                        cid,
                        meeting_id,
                    )
                    continue
                if normalized_email and not verified_host_email:
                    logger.warning(
                        "Ignoring host promotion for non-host email %s in meeting %s",
                        normalized_email,
                        meeting_id,
                    )
                    continue
                role = "host"
                manager.promote_to_host(meeting_id, websocket, cid)
                await sync_waiting_room(meeting_id)
                # Send current room state to host so they see who is already there
                room_metadata = manager.get_room_metadata(meeting_id)
                await websocket.send_json({
                    "type": "room-state",
                    "participants": room_metadata
                })
                continue

            # --- Logging join-request received ---
            if msg_type in ["join-request", "ask_to_join"]:
                user_data = data.get("user") or {}
                name = user_data.get("name") or data.get("name") or "Participant"
                req_email = user_data.get("email") or data.get("email") or email
                picture = user_data.get("picture") or data.get("picture")
                
                logger.info(f"join-request from {cid} ({name}) for meeting {meeting_id}")
                manager.add_waiting_request(meeting_id, cid, name, req_email, picture)
                
                join_msg = {
                    "type": "incoming-join-request",
                    "sender": cid,
                    "user": {
                        "id": cid,
                        "name": name,
                        "email": req_email,
                        "picture": picture,
                    }
                }
                
                # Send incoming-join-request ONLY to the host
                success = await manager.send_to_host(meeting_id, join_msg)
                
                # Fallback: if no host found via metadata, try direct WS from rooms structure
                if not success and meeting_id in manager.rooms:
                    h_ws = manager.rooms[meeting_id].get("host")
                    if h_ws:
                        try:
                            await h_ws.send_json(join_msg)
                            success = True
                            logger.info(f"join-request sent to host WS fallback for {meeting_id}")
                        except: pass
                
                if success:
                    logger.info(f"incoming-join-request sent to host for meeting {meeting_id}")
                else:
                    logger.warning(f"Could not find any host to send join-request for {meeting_id}")
                
                await sync_waiting_room(meeting_id)
                continue

            if msg_type == "join-room":
                # Original logic for room initialization
                name = data.get("name") or ("Host" if role == "host" else "Participant")
                joined_at = data.get("joined_at")
                email = data.get("email")
                client_admitted = bool(data.get("admitted"))
                
                user_record = get_or_create_user(
                    user_id=data.get("user_id") or cid,
                    firebase_uid=data.get("firebase_uid"),
                    name=name,
                    email=email,
                )
                user_id = user_record.get("id") if isinstance(user_record, dict) else (data.get("user_id") or cid)
                
                # Security check for participants. Guests and invited participants
                # still need explicit host approval before entering the room.
                if role == "participant":
                    if not client_admitted and not manager.is_participant_accepted(meeting_id, cid):
                        logger.warning(f"join-room BLOCKED: {cid} not admitted to {meeting_id}")
                        await websocket.send_json({
                            "type": "join-blocked",
                            "reason": "not-admitted"
                        })
                        continue
                    else:
                        manager.add_accepted_participant(meeting_id, cid)

                # Database sync
                mid = ensure_meeting_record(
                    meeting_id,
                    host_user_id=user_id if role == "host" else None,
                    title=f"Meeting {str(meeting_id)[:8]}",
                    status="active",
                    started_at=joined_at if role == "host" else None,
                )
                if mid:
                    upsert_participant_record(mid, user_id, role=role, joined_at=joined_at)

                if role == "host":
                    await sync_waiting_room(meeting_id)

                # Update manager's metadata tracker with a/v state and picture
                is_audio_enabled = data.get("isAudioEnabled", True)
                is_video_enabled = data.get("isVideoEnabled", True)
                picture = data.get("picture")
                
                manager.mark_joined(meeting_id, websocket, role, cid, {
                    "name": name, 
                    "picture": picture,
                    "isAudioEnabled": is_audio_enabled,
                    "isVideoEnabled": is_video_enabled
                })

                # Send current room state (metadata of all others) to the NEW joiner
                room_metadata = manager.get_room_metadata(meeting_id)
                await websocket.send_json({
                    "type": "room-state",
                    "participants": room_metadata
                })

                # Broadcast the NEW joiner to everyone else
                await manager.broadcast_to_all(meeting_id, {
                    "type": "user-joined",
                    "sender": cid,
                    "name": name,
                    "role": role,
                    "picture": picture,
                    "isAudioEnabled": is_audio_enabled,
                    "isVideoEnabled": is_video_enabled
                })
                continue

            if msg_type in ["admit", "accept_user", "deny"]:
                if role != "host":
                    logger.warning(
                        "Ignoring %s from non-host client %s in meeting %s",
                        msg_type,
                        cid,
                        meeting_id,
                    )
                    continue
                target_id = data.get("target") or (data.get("user") or {}).get("id")
                if target_id:
                    manager.remove_waiting_request(meeting_id, target_id)
                    if msg_type in ["admit", "accept_user"]:
                        manager.add_accepted_participant(meeting_id, target_id)
                    
                    await sync_waiting_room(meeting_id)
                    
                    response_type = "accepted" if msg_type in ["admit", "accept_user"] else "deny"
                    await manager.send_to_client(meeting_id, target_id, {
                        "type": response_type,
                        "sender": cid,
                        "meetingId": meeting_id,
                        "admitted": response_type == "accepted"
                    })
                continue

            if msg_type == "participant-update":
                manager.update_metadata(meeting_id, websocket, data)
                # Only broadcast update if they have actually joined
                if cid in manager.user_records.get(meeting_id, {}).values():
                    await manager.broadcast_to_all(meeting_id, {"sender": cid, **data})
                continue
            
            # Default broadcast for RTC signaling - only if sender is admitted/joined
            if manager.is_participant_accepted(meeting_id, cid) or role == "host":
                await manager.broadcast_to_all(meeting_id, {
                    "sender": cid,
                    **data
                })
            else:
                logger.debug(f"Suppressing broadcast from unjoined client {cid}")
            continue

    except WebSocketDisconnect:
        manager.disconnect(websocket, meeting_id)
        manager.remove_waiting_request(meeting_id, cid)
        await sync_waiting_room(meeting_id)
        await manager.broadcast_to_all(meeting_id, {
            "type": "user-left",
            "sender": cid
        })
        logger.info(f"WebSocket disconnected: meetingId={meeting_id}, clientId={cid}")
    except Exception as e:
        logger.error(f"WebSocket error in meeting {meeting_id} for client {cid}: {e}")
        manager.disconnect(websocket, meeting_id)
