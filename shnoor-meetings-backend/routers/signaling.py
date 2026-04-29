import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.connection_manager import manager
from core.database import (
    ensure_meeting_record,
    get_meeting_record,
    get_or_create_user,
    mark_participant_left,
    normalize_uuid_or_none,
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

@router.websocket("/ws/{meeting_id}/{role_or_id}")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str, role_or_id: str, client_id: str = None):
    """
    WebSocket endpoint for handling signaling.
    Path format: /ws/{meeting_id}/{role}?client_id=...
    Also supports old format: /ws/{meeting_id}/{client_id}
    """
    # Detect if role_or_id is a role or a client_id
    is_explicit_role = role_or_id in ["host", "participant"]
    role = role_or_id if is_explicit_role else "participant"
    
    # Final client ID resolution
    cid = client_id or (role_or_id if not is_explicit_role else None)
    if not cid:
        import uuid
        cid = str(uuid.uuid4())
        
    await manager.connect(websocket, meeting_id, role, cid)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            # Allow upgrading to host via message (legacy frontend support)
            if msg_type in ["host_join", "host-ready"]:
                role = "host"
                manager.promote_to_host(meeting_id, websocket, cid)
                await sync_waiting_room(meeting_id)
                continue

            # --- Logging join-request received ---
            if msg_type in ["join-request", "ask_to_join"]:
                logger.info(f"join-request received from {cid} for meeting {meeting_id}")
                
                user_data = data.get("user") or {}
                name = user_data.get("name") or data.get("name") or "Participant"
                email = user_data.get("email") or data.get("email")
                
                manager.add_waiting_request(meeting_id, cid, name, email)
                
                # Send incoming-join-request ONLY to the host
                success = await manager.send_to_host(meeting_id, {
                    "type": "incoming-join-request",
                    "user": {
                        "id": cid,
                        "name": name,
                        "email": email
                    }
                })
                
                if success:
                    logger.info(f"incoming-join-request sent to host for meeting {meeting_id}")
                
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
                
                # Security check for participants
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

                # Update manager's metadata tracker
                manager.update_metadata(meeting_id, websocket, {"name": name, "role": role})

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
                    "role": role
                })
                continue

            if msg_type in ["admit", "accept_user", "deny"]:
                target_id = data.get("target") or (data.get("user") or {}).get("id")
                if target_id:
                    manager.remove_waiting_request(meeting_id, target_id)
                    if msg_type in ["admit", "accept_user"]:
                        manager.add_accepted_participant(meeting_id, target_id)
                    
                    await sync_waiting_room(meeting_id)
                    
                    response_type = "accepted" if msg_type in ["admit", "accept_user"] else "deny"
                    await manager.send_to_client(meeting_id, target_id, {
                        "type": response_type,
                        "sender": cid
                    })
                continue

            if msg_type == "participant-update":
                manager.update_metadata(meeting_id, websocket, data)
                # Fall through to default broadcast below
            
            # Default broadcast for all other signaling (RTC offers/answers)
            await manager.broadcast_to_all(meeting_id, {
                "sender": cid,
                **data
            })

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
