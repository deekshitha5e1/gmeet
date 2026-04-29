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


async def sync_waiting_room(room_id: str):
    await manager.send_to_role(room_id, "host", {
        "type": "waiting-room-sync",
        "requests": manager.get_waiting_requests(room_id),
    })

@router.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    """
    WebSocket endpoint for handling WebRTC signaling and real-time chat for a specific room.
    """
    await manager.connect(websocket, room_id, client_id)

    try:
        while True:
            # We expect JSON payloads containing signaling data (offers, answers, ice candidates)
            # or custom messages (like chat).
            data = await websocket.receive_json()
            
            msg_type = data.get("type")
            target_id = data.get("target")

            if msg_type == "join-room":
                requested_role = (data.get("role") or "participant").strip().lower()
                name = data.get("name") or ("Host" if requested_role == "host" else "Participant")
                joined_at = data.get("joined_at")
                email = data.get("email")
                admitted = data.get("admitted", False)  # frontend passes this after host admits
                user_id = get_or_create_user(
                    user_id=data.get("user_id") or client_id,
                    firebase_uid=data.get("firebase_uid"),
                    name=name,
                    email=email,
                )
                meeting_record = get_meeting_record(room_id) or {}
                meeting_host_email = (meeting_record.get("host_email") or "").strip().lower()
                normalized_email = (email or "").strip().lower()
                is_meeting_host = bool(
                    (meeting_record.get("host_id") and meeting_record.get("host_id") == user_id)
                    or (meeting_host_email and normalized_email == meeting_host_email)
                )
                if not meeting_record and requested_role == "host":
                    role = "host"
                else:
                    role = "host" if is_meeting_host else "participant"

                logger.info(f"join-room: client={client_id} name={name} email={email} requested_role={requested_role} resolved_role={role} is_meeting_host={is_meeting_host}")

                if role == "participant":
                    # Auto-admit if:
                    # 1. Already in the accepted set (admitted via lobby), OR
                    # 2. Client passed admitted=true (already approved, page refresh etc.)
                    if admitted:
                        manager.add_accepted_participant(room_id, client_id)
                    
                    if not manager.is_participant_accepted(room_id, client_id):
                        logger.info(f"join-room BLOCKED: participant {client_id} not admitted yet")
                        await manager.send_to_websocket(websocket, {
                            "type": "join-blocked",
                            "reason": "not-admitted",
                        })
                        continue

                meeting_id = ensure_meeting_record(
                    room_id,
                    host_user_id=user_id if role == "host" else None,
                    title=f"Meeting {str(room_id)[:8]}",
                    status="active",
                    started_at=joined_at if role == "host" else None,
                )
                if meeting_id:
                    upsert_participant_record(meeting_id, user_id, role=role, joined_at=joined_at)

                manager.set_connection_user(room_id, websocket, {
                    "user_id": user_id,
                    "email": email,
                    "name": name,
                    "role": role,
                })

                if role == "host":
                    manager.add_accepted_participant(room_id, client_id)

                if role == "host":
                    await manager.send_to_websocket(websocket, {
                        "type": "waiting-room-sync",
                        "requests": manager.get_waiting_requests(room_id)
                    })

                join_message = {
                    "type": "user-joined",
                    "sender": client_id,
                    "client_id": client_id,
                    "name": name,
                    "role": role,
                    "message": f"User {client_id} joined the meeting"
                }
                await manager.broadcast_to_room(room_id, join_message, sender=websocket)
                continue

            if msg_type in {"host-ready", "host_join"}:
                # Register this connection as host so send_to_role("host") works
                # even while the host is still in the lobby (before join-room is sent)
                manager.set_connection_user(room_id, websocket, {"role": "host"})
                manager.add_accepted_participant(room_id, client_id)
                await manager.send_to_websocket(websocket, {
                    "type": "waiting-room-sync",
                    "requests": manager.get_waiting_requests(room_id)
                })
                continue

            if msg_type in {"join-request", "ask_to_join"}:
                requester_name = data.get("name", "Participant")
                manager.add_waiting_request(room_id, client_id, requester_name)
                await manager.send_to_role(room_id, "host", {
                    "type": "join_request",
                    "sender": client_id,
                    "client_id": client_id,
                    "name": requester_name,
                })
                await sync_waiting_room(room_id)
                continue

            if msg_type in {"admit", "accept_user", "deny"} and target_id:
                manager.remove_waiting_request(room_id, target_id)
                if msg_type in {"admit", "accept_user"}:
                    manager.add_accepted_participant(room_id, target_id)
                await sync_waiting_room(room_id)

                response_type = "accepted" if msg_type in {"admit", "accept_user"} else "deny"
                logger.info(f"Host {client_id} {response_type} participant {target_id} in room {room_id}")
                # Send a clean message — do NOT spread **data to avoid leaking 'target'
                # which would cause the participant's frontend to filter the message out.
                await manager.send_to_client(room_id, target_id, {
                    "type": response_type,
                    "sender": client_id,
                    "room_id": room_id,
                })
                continue

            message_to_send = {
                "type": msg_type,
                "sender": client_id,
                **data
            }

            await manager.broadcast_to_room(room_id, message_to_send, sender=websocket)

            if msg_type == "chat":
                user_meta = manager.get_connection_user(room_id, websocket) or {}
                sender_id = normalize_uuid_or_none(user_meta.get("user_id"))
                meeting_id = normalize_uuid_or_none(room_id)
                if sender_id and meeting_id and data.get("text"):
                    save_chat_message(meeting_id, sender_id, data.get("text"), sent_at=data.get("sent_at"))

            # --- AI Chatbot Interception ---
            if msg_type == "chat" and data.get("text", "").lower().startswith("@ai"):
                # Simulate answering as Shnoor AI
                prompt = data.get("text")[3:].strip()
                ai_response_text = f"Beep boop! This is Shnoor AI. You asked: '{prompt}'. (Insert LLM logic here!)"
                
                # Send the response back to EVERYONE in the room (including the sender of the prompt)
                ai_message = {
                    "type": "chat",
                    "sender": "Shnoor AI ✨",
                    "text": ai_response_text
                }
                
                # We broadcast to others
                await manager.broadcast_to_room(room_id, ai_message)
                # And we must explicitly send it to the requesting websocket too since we omitted it in broadcast
                await websocket.send_json(ai_message)
    except WebSocketDisconnect:
        metadata = manager.disconnect(websocket, room_id) or {}
        removed_request = manager.remove_waiting_request(room_id, client_id)
        if metadata.get("user_id"):
            mark_participant_left(room_id, metadata["user_id"])
        if removed_request:
            await sync_waiting_room(room_id)
        # Notify others that this user left
        await manager.broadcast_to_room(room_id, {
            "type": "user-left",
            "sender": client_id,
            "client_id": client_id,
            "message": f"User {client_id} left the meeting"
        })
        logger.info(f"Client {client_id} disconnected from room {room_id}")
    except Exception as e:
        logger.error(f"Error in websocket for client {client_id}: {e}")
        metadata = manager.disconnect(websocket, room_id) or {}
        removed_request = manager.remove_waiting_request(room_id, client_id)
        if metadata.get("user_id"):
            mark_participant_left(room_id, metadata["user_id"])
        if removed_request:
            await sync_waiting_room(room_id)
