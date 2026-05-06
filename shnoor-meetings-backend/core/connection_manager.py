from typing import Dict, List, Any
from fastapi import WebSocket
import json
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Maps a meeting_id to its connections
        # rooms = {
        #   meetingId: {
        #     "host": WebSocket, (or list if multiple connections)
        #     "participants": [WebSocket, ...]
        #   }
        # }
        self.rooms: Dict[str, Dict[str, Any]] = {}
        
        self.connection_metadata: Dict[str, Dict[WebSocket, dict]] = {}
        self.user_records: Dict[str, Dict[WebSocket, str]] = {}
        self.waiting_requests: Dict[str, Dict[str, dict]] = {}
        self.accepted_participants: Dict[str, set[str]] = {}

    async def connect(self, websocket: WebSocket, meeting_id: str, role: str, client_id: str):
        await websocket.accept()
        
        if meeting_id not in self.rooms:
            self.rooms[meeting_id] = {"host": None, "participants": [], "metadata": {}}
            
        if meeting_id not in self.user_records:
            self.user_records[meeting_id] = {}
        if meeting_id not in self.waiting_requests:
            self.waiting_requests[meeting_id] = {}
        if meeting_id not in self.accepted_participants:
            self.accepted_participants[meeting_id] = set()

        if role == "host":
            # If there was a previous host connection, move it to participants or close it
            if self.rooms[meeting_id]["host"] and self.rooms[meeting_id]["host"] != websocket:
                self.rooms[meeting_id]["participants"].append(self.rooms[meeting_id]["host"])
            self.rooms[meeting_id]["host"] = websocket
            self.accepted_participants[meeting_id].add(client_id)
            logger.info(f"Host {client_id} connected to meeting {meeting_id}")
        else:
            # Prevent duplicate connections for the same client_id in the same room
            # If this client already has an active websocket, close it before adding the new one
            for ws, existing_cid in list(self.user_records.get(meeting_id, {}).items()):
                if existing_cid == client_id and ws != websocket:
                    logger.info(f"Closing stale connection for client {client_id}")
                    try:
                        # We don't await here as it's a background cleanup
                        import asyncio
                        asyncio.create_task(ws.close(code=1000, reason="New connection established"))
                    except: pass
                    if ws in self.rooms[meeting_id]["participants"]:
                        self.rooms[meeting_id]["participants"].remove(ws)
                    if meeting_id in self.connection_metadata and ws in self.connection_metadata[meeting_id]:
                        del self.connection_metadata[meeting_id][ws]
                    del self.user_records[meeting_id][ws]

            if websocket not in self.rooms[meeting_id]["participants"]:
                self.rooms[meeting_id]["participants"].append(websocket)
            logger.info(f"Participant {client_id} connected to meeting {meeting_id}")

        self.user_records[meeting_id][websocket] = client_id
        
        # Initialize connection metadata
        if meeting_id not in self.connection_metadata:
            self.connection_metadata[meeting_id] = {}
        self.connection_metadata[meeting_id][websocket] = {
            "id": client_id,
            "role": role,
            "name": "Participant" # Default
        }
        
        logger.info(f"WebSocket connected: meetingId={meeting_id}, role={role}, clientId={client_id}")

    def update_metadata(self, meeting_id: str, websocket: WebSocket, metadata: dict):
        if meeting_id in self.connection_metadata and websocket in self.connection_metadata[meeting_id]:
            # Preserve existing ID and role if not provided
            current = self.connection_metadata[meeting_id][websocket]
            updated = {**current, **metadata}
            self.connection_metadata[meeting_id][websocket] = updated

    def get_room_metadata(self, meeting_id: str):
        if meeting_id in self.connection_metadata:
            return list(self.connection_metadata[meeting_id].values())
        return []

    def promote_to_host(self, meeting_id: str, websocket: WebSocket, client_id: str):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            # Remove from participants if it was there
            if websocket in room["participants"]:
                room["participants"].remove(websocket)
            
            # Set as host
            room["host"] = websocket
            self.accepted_participants[meeting_id].add(client_id)
            
            # Ensure metadata role is synced
            if meeting_id in self.connection_metadata and websocket in self.connection_metadata[meeting_id]:
                self.connection_metadata[meeting_id][websocket]["role"] = "host"
                
            logger.info(f"Connection promoted to HOST: meetingId={meeting_id}, clientId={client_id}")

    def disconnect(self, websocket: WebSocket, meeting_id: str):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            if room["host"] == websocket:
                room["host"] = None
                logger.info(f"Host disconnected from meeting {meeting_id}")
            elif websocket in room["participants"]:
                room["participants"].remove(websocket)
                logger.info(f"Participant disconnected from meeting {meeting_id}")

            if websocket in self.user_records.get(meeting_id, {}):
                del self.user_records[meeting_id][websocket]
            
            # CRITICAL: Also clean up metadata to prevent ghost participants
            if meeting_id in self.connection_metadata and websocket in self.connection_metadata[meeting_id]:
                del self.connection_metadata[meeting_id][websocket]

            # Clean up empty rooms, but PERSIST accepted_participants to allow reconnects/refreshes
            if not room["host"] and not room["participants"]:
                # Keep metadata and accepted participants for a while or until server restart
                # This allows users to refresh without being blocked by "not-admitted"
                del self.rooms[meeting_id]
                # self.user_records.pop(meeting_id, None) # Keep this or let it clear
                # self.waiting_requests.pop(meeting_id, None)
                # self.accepted_participants.pop(meeting_id, None) # DO NOT POP THIS
                logger.info(f"Room structures for {meeting_id} cleared from memory, but admission state preserved.")

    async def send_to_host(self, meeting_id: str, message: dict):
        """Broadcasts a message to ALL connections marked as host for this meeting."""
        sent_count = 0
        logger.info(f"Attempting to send {message.get('type')} to host in meeting {meeting_id}")
        if meeting_id in self.connection_metadata:
            for ws, meta in self.connection_metadata[meeting_id].items():
                if meta.get("role") == "host":
                    try:
                        await ws.send_json(message)
                        sent_count += 1
                    except Exception as e:
                        logger.error(f"Error sending message to host connection: {e}")
        
        if sent_count > 0:
            logger.info(f"Message {message.get('type')} sent to {sent_count} host connection(s) in {meeting_id}")
            return True
            
        logger.warning(f"No active host connection found for meeting {meeting_id}. Metadata keys: {list(self.connection_metadata.get(meeting_id, {}).keys())}")
        return False

    async def broadcast_to_participants(self, meeting_id: str, message: dict):
        if meeting_id in self.rooms:
            for ws in self.rooms[meeting_id]["participants"]:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def broadcast_to_all(self, meeting_id: str, message: dict):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            all_ws = []
            if room["host"]:
                all_ws.append(room["host"])
            all_ws.extend(room["participants"])
            
            for ws in all_ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def send_to_client(self, meeting_id: str, client_id: str, message: dict):
        sent = False
        if meeting_id in self.user_records:
            for ws, stored_id in self.user_records[meeting_id].items():
                if stored_id == client_id:
                    try:
                        await ws.send_json(message)
                        sent = True
                    except Exception as e:
                        logger.error(f"Error sending to client {client_id}: {e}")
        
        if sent:
            logger.info(f"Message {message.get('type')} sent to client {client_id}")
        else:
            logger.warning(f"Could not find active connection for client {client_id} in meeting {meeting_id}")
        return sent

    def add_waiting_request(self, meeting_id: str, client_id: str, name: str, email: str = None):
        if meeting_id not in self.waiting_requests:
            self.waiting_requests[meeting_id] = {}
        self.waiting_requests[meeting_id][client_id] = {
            "id": client_id,
            "name": name,
            "email": email
        }

    def remove_waiting_request(self, meeting_id: str, client_id: str):
        if meeting_id in self.waiting_requests:
            return self.waiting_requests[meeting_id].pop(client_id, None)
        return None

    def get_waiting_requests(self, meeting_id: str):
        return list(self.waiting_requests.get(meeting_id, {}).values())

    def add_accepted_participant(self, meeting_id: str, client_id: str):
        if meeting_id not in self.accepted_participants:
            self.accepted_participants[meeting_id] = set()
        self.accepted_participants[meeting_id].add(client_id)

    def is_participant_accepted(self, meeting_id: str, client_id: str):
        return client_id in self.accepted_participants.get(meeting_id, set())

    def register_meeting(self, meeting_id: str, **kwargs):
        if meeting_id not in self.rooms:
            self.rooms[meeting_id] = {
                "host": None,
                "participants": [],
                "metadata": {}
            }
        self.rooms[meeting_id]["metadata"].update(kwargs)
        logger.info(f"Meeting {meeting_id} registered with metadata: {kwargs}")

    def get_registered_meeting(self, meeting_id: str):
        return self.rooms.get(meeting_id, {}).get("metadata")

manager = ConnectionManager()
