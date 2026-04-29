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

@router.websocket("/ws/{meeting_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str, role: str, client_id: str = None):
    """
    WebSocket endpoint for handling signaling.
    Path format: /ws/{meeting_id}/{role}?client_id=...
    """
    # Fallback for client_id if not provided in query
    if not client_id:
        import uuid
        client_id = str(uuid.uuid4())
        
    await manager.connect(websocket, meeting_id, role, client_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            # --- Logging join-request received ---
            if msg_type in ["join-request", "ask_to_join"]:
                logger.info(f"join-request received from {client_id} for meeting {meeting_id}")
                
                user_data = data.get("user") or {}
                name = user_data.get("name") or data.get("name") or "Participant"
                email = user_data.get("email") or data.get("email")
                
                manager.add_waiting_request(meeting_id, client_id, name, email)
                
                # Send incoming-join-request ONLY to the host
                success = await manager.send_to_host(meeting_id, {
                    "type": "incoming-join-request",
                    "user": {
                        "id": client_id,
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
                    user_id=data.get("user_id") or client_id,
                    firebase_uid=data.get("firebase_uid"),
                    name=name,
                    email=email,
                )
                user_id = user_record.get("id") if isinstance(user_record, dict) else (data.get("user_id") or client_id)
                
                # Security check for participants
                if role == "participant":
                    if not client_admitted and not manager.is_participant_accepted(meeting_id, client_id):
                        logger.warning(f"join-room BLOCKED: {client_id} not admitted to {meeting_id}")
                        await websocket.send_json({
                            "type": "join-blocked",
                            "reason": "not-admitted"
                        })
                        continue
                    else:
                        manager.add_accepted_participant(meeting_id, client_id)

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

                # Broadcast to others
                await manager.broadcast_to_all(meeting_id, {
                    "type": "user-joined",
                    "sender": client_id,
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
                        "sender": client_id
                    })
                continue

            # Default broadcast for all other signaling (RTC offers/answers)
            await manager.broadcast_to_all(meeting_id, {
                "sender": client_id,
                **data
            })

    except WebSocketDisconnect:
        manager.disconnect(websocket, meeting_id)
        manager.remove_waiting_request(meeting_id, client_id)
        await sync_waiting_room(meeting_id)
        await manager.broadcast_to_all(meeting_id, {
            "type": "user-left",
            "sender": client_id
        })
        logger.info(f"WebSocket disconnected: meetingId={meeting_id}, clientId={client_id}")
    except Exception as e:
        logger.error(f"WebSocket error in meeting {meeting_id} for client {client_id}: {e}")
        manager.disconnect(websocket, meeting_id)
