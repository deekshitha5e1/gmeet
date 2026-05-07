import logging
from typing import Dict, List, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # meeting_id -> {websocket: metadata}
        self.connection_metadata: Dict[str, Dict[WebSocket, dict]] = {}
        # meeting_id -> {host: ws, participants: [ws1, ws2]}
        self.rooms: Dict[str, dict] = {}
        # meeting_id -> {websocket: client_id}
        self.user_records: Dict[str, Dict[WebSocket, str]] = {}
        # meeting_id -> {client_id: name/metadata}
        self.waiting_requests: Dict[str, Dict[str, dict]] = {}
        # meeting_id -> set of accepted client_ids
        self.accepted_participants: Dict[str, Set[str]] = {}

    async def connect(self, websocket: WebSocket, meeting_id: str, role: str, client_id: str):
        await websocket.accept()
        
        if meeting_id not in self.rooms:
            self.rooms[meeting_id] = {"host": None, "participants": []}
        if meeting_id not in self.connection_metadata:
            self.connection_metadata[meeting_id] = {}
        if meeting_id not in self.user_records:
            self.user_records[meeting_id] = {}
        if meeting_id not in self.accepted_participants:
            self.accepted_participants[meeting_id] = set()

        # Handle existing connections for the same client_id (reconnect logic)
        for ws, existing_cid in list(self.user_records.get(meeting_id, {}).items()):
            if existing_cid == client_id and ws != websocket:
                try:
                    logger.info(f"Closing stale connection for client {client_id} in {meeting_id}")
                    # Remove from metadata and rooms before closing
                    if ws in self.connection_metadata.get(meeting_id, {}):
                        del self.connection_metadata[meeting_id][ws]
                    if ws in self.rooms[meeting_id]["participants"]:
                        self.rooms[meeting_id]["participants"].remove(ws)
                    if self.rooms[meeting_id]["host"] == ws:
                        self.rooms[meeting_id]["host"] = None
                    await ws.close(code=1000)
                except:
                    pass
                self.user_records[meeting_id].pop(ws, None)

        self.user_records[meeting_id][websocket] = client_id

        if role == "host":
            # If there was a previous host connection, move it to participants or close it
            if self.rooms[meeting_id]["host"] and self.rooms[meeting_id]["host"] != websocket:
                self.rooms[meeting_id]["participants"].append(self.rooms[meeting_id]["host"])
            
            self.rooms[meeting_id]["host"] = websocket
            self.connection_metadata[meeting_id][websocket] = {
                "id": client_id,
                "role": role,
                "name": "Host"
            }
            # The host is always accepted
            self.accepted_participants[meeting_id].add(client_id)
            logger.info(f"Host {client_id} connected to meeting {meeting_id}")
        else:
            # Participants are added to metadata only when they join the room (mark_joined)
            # but we record their record for send_to_client
            logger.info(f"Participant {client_id} connected to meeting {meeting_id} lobby")

    def disconnect(self, websocket: WebSocket, meeting_id: str):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            if websocket in room["participants"]:
                room["participants"].remove(websocket)
            if room["host"] == websocket:
                room["host"] = None
            
            # CRITICAL: Also clean up metadata to prevent ghost participants
            if meeting_id in self.connection_metadata and websocket in self.connection_metadata[meeting_id]:
                del self.connection_metadata[meeting_id][websocket]
            
            # Clean up user records
            if meeting_id in self.user_records and websocket in self.user_records[meeting_id]:
                del self.user_records[meeting_id][websocket]
            
            # If room is empty, we could potentially clear it, but let's keep it for state
            if not room["host"] and not room["participants"]:
                # Optionally clear small rooms after some time
                pass

    def is_joined_connection(self, meeting_id: str, websocket: WebSocket):
        if meeting_id not in self.rooms:
            return False

        room = self.rooms[meeting_id]
        return room.get("host") == websocket or websocket in room.get("participants", [])

    def mark_joined(self, meeting_id: str, websocket: WebSocket, role: str, client_id: str, metadata: dict):
        """Moves a connection from 'connected' to 'joined' in the meeting room."""
        if meeting_id not in self.rooms:
            return
            
        if role == "host":
            self.rooms[meeting_id]["host"] = websocket
        else:
            if websocket not in self.rooms[meeting_id]["participants"]:
                self.rooms[meeting_id]["participants"].append(websocket)
        
        if meeting_id not in self.connection_metadata:
            self.connection_metadata[meeting_id] = {}
            
        self.connection_metadata[meeting_id][websocket] = {
            "id": client_id,
            "role": role,
            **metadata,
        }

    def update_metadata(self, meeting_id: str, websocket: WebSocket, data: dict):
        if meeting_id in self.connection_metadata and websocket in self.connection_metadata[meeting_id]:
            self.connection_metadata[meeting_id][websocket].update(data)

    def get_room_metadata(self, meeting_id: str):
        if meeting_id not in self.connection_metadata or meeting_id not in self.rooms:
            return []
            
        room = self.rooms[meeting_id]
        active_ws = []
        if room["host"]:
            active_ws.append(room["host"])
        active_ws.extend(room["participants"])
        
        metadata = []
        for ws in active_ws:
            if ws in self.connection_metadata[meeting_id]:
                metadata.append(self.connection_metadata[meeting_id][ws])
        return metadata

    def promote_to_host(self, meeting_id: str, websocket: WebSocket, client_id: str):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            # Remove from participants if it was there
            if websocket in room["participants"]:
                room["participants"].remove(websocket)
            
            # Set as host
            room["host"] = websocket
            self.accepted_participants.setdefault(meeting_id, set()).add(client_id)
            
            # Ensure metadata role is synced
            if meeting_id not in self.connection_metadata:
                self.connection_metadata[meeting_id] = {}
                
            if websocket not in self.connection_metadata[meeting_id]:
                self.connection_metadata[meeting_id][websocket] = {
                    "id": client_id,
                    "role": "host",
                    "name": "Host"
                }
            else:
                self.connection_metadata[meeting_id][websocket]["role"] = "host"
                
            logger.info(f"Client {client_id} promoted to host for meeting {meeting_id}")

    async def broadcast_to_all(self, meeting_id: str, message: dict):
        if meeting_id in self.rooms:
            room = self.rooms[meeting_id]
            targets = []
            if room["host"]:
                targets.append(room["host"])
            targets.extend(room["participants"])
            
            for websocket in targets:
                try:
                    await websocket.send_json(message)
                except:
                    pass

    async def send_to_host(self, meeting_id: str, message: dict):
        """Broadcasts a message to ALL connections marked as host for this meeting."""
        sent_count = 0
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
        return False

    async def send_to_client(self, meeting_id: str, client_id: str, message: dict):
        if meeting_id in self.user_records:
            for ws, stored_id in self.user_records[meeting_id].items():
                if stored_id == client_id:
                    try:
                        await ws.send_json(message)
                        return True
                    except:
                        pass
        return False

    def add_waiting_request(self, meeting_id: str, client_id: str, name: str, email: str = None, picture: str = None):
        if meeting_id not in self.waiting_requests:
            self.waiting_requests[meeting_id] = {}
        self.waiting_requests[meeting_id][client_id] = {
            "id": client_id,
            "name": name,
            "email": email,
            "picture": picture
        }

    def remove_waiting_request(self, meeting_id: str, client_id: str):
        if meeting_id in self.waiting_requests:
            self.waiting_requests[meeting_id].pop(client_id, None)

    def get_waiting_requests(self, meeting_id: str):
        return list(self.waiting_requests.get(meeting_id, {}).values())

    def add_accepted_participant(self, meeting_id: str, client_id: str):
        if meeting_id not in self.accepted_participants:
            self.accepted_participants[meeting_id] = set()
        self.accepted_participants[meeting_id].add(client_id)

    def is_participant_accepted(self, meeting_id: str, client_id: str):
        return client_id in self.accepted_participants.get(meeting_id, set())

    def register_meeting(self, room_id: str, host_id: str = None, host_email: str = None, host_name: str = None):
        """Registers a meeting manually if needed."""
        if room_id not in self.rooms:
            self.rooms[room_id] = {"host": None, "participants": []}
            # We could store host info here if needed

    def get_registered_meeting(self, room_id: str):
        return self.rooms.get(room_id)

manager = ConnectionManager()
