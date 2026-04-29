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

            # Clean up empty rooms
            if not room["host"] and not room["participants"]:
                del self.rooms[meeting_id]
                self.user_records.pop(meeting_id, None)
                self.waiting_requests.pop(meeting_id, None)
                self.accepted_participants.pop(meeting_id, None)
                logger.info(f"Meeting {meeting_id} cleared from memory")

    async def send_to_host(self, meeting_id: str, message: dict):
        if meeting_id in self.rooms:
            host_ws = self.rooms[meeting_id].get("host")
            if host_ws:
                try:
                    await host_ws.send_json(message)
                    logger.info(f"Message sent to host in {meeting_id}: {message.get('type')}")
                    return True
                except Exception as e:
                    logger.error(f"Error sending message to host: {e}")
        logger.warning(f"No active host connection found for meeting {meeting_id}")
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
        if meeting_id in self.user_records:
            for ws, stored_id in self.user_records[meeting_id].items():
                if stored_id == client_id:
                    try:
                        await ws.send_json(message)
                        return True
                    except Exception:
                        pass
        return False

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
