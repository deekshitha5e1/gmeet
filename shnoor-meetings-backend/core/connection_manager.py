from typing import Dict, List, Any
from fastapi import WebSocket
import json
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Maps a room_id to a list of active websocket connections
        # Example: {"room1": [client1, client2], ...}
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Keeps track of the user/client id associated with a websocket for a room
        # Example: {"room1": {websocket: "user_1"}}
        self.user_records: Dict[str, Dict[WebSocket, str]] = {}
        self.connection_users: Dict[str, Dict[WebSocket, dict]] = {}
        self.waiting_requests: Dict[str, Dict[str, dict]] = {}
        self.accepted_participants: Dict[str, set[str]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, client_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
            self.user_records[room_id] = {}
            self.connection_users[room_id] = {}
            self.waiting_requests[room_id] = {}
            self.accepted_participants[room_id] = set()
            
        self.active_connections[room_id].append(websocket)
        self.user_records[room_id][websocket] = client_id
        
        logger.info(f"Client {client_id} joined room {room_id}")

    def disconnect(self, websocket: WebSocket, room_id: str):
        metadata = self.connection_users.get(room_id, {}).get(websocket)

        if room_id in self.active_connections:
            if websocket in self.active_connections[room_id]:
                self.active_connections[room_id].remove(websocket)
            
            if websocket in self.user_records.get(room_id, {}):
                del self.user_records[room_id][websocket]

            if websocket in self.connection_users.get(room_id, {}):
                del self.connection_users[room_id][websocket]
                
            # Clean up empty rooms
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                del self.user_records[room_id]
                self.connection_users.pop(room_id, None)
                self.waiting_requests.pop(room_id, None)
                self.accepted_participants.pop(room_id, None)

        return metadata

    async def broadcast_to_room(self, room_id: str, message: dict, sender: WebSocket = None):
        """
        Broadcasts a message to all users in the room, optionally excluding the sender.
        """
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                if connection != sender:
                    try:
                        await connection.send_json(message)
                    except Exception as e:
                        logger.error(f"Error sending message to client: {e}")

    async def send_to_client(self, room_id: str, client_id: str, message: dict):
        if room_id not in self.user_records:
            return

        for connection, stored_client_id in self.user_records[room_id].items():
            if stored_client_id == client_id:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending targeted message to client {client_id}: {e}")
                return

    async def send_to_websocket(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending websocket message: {e}")

    async def send_to_role(self, room_id: str, role: str, message: dict):
        if room_id not in self.connection_users:
            return

        for connection, metadata in list(self.connection_users[room_id].items()):
            if (metadata or {}).get("role") != role:
                continue

            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to {role} connection: {e}")

    def set_connection_user(self, room_id: str, websocket: WebSocket, metadata: dict):
        if room_id not in self.connection_users:
            self.connection_users[room_id] = {}

        current = self.connection_users[room_id].get(websocket, {})
        self.connection_users[room_id][websocket] = {
            **current,
            **metadata,
        }

    def get_connection_user(self, room_id: str, websocket: WebSocket):
        return self.connection_users.get(room_id, {}).get(websocket)

    def add_waiting_request(self, room_id: str, client_id: str, name: str):
        if room_id not in self.waiting_requests:
            self.waiting_requests[room_id] = {}

        self.waiting_requests[room_id][client_id] = {
            "id": client_id,
            "name": name,
        }

    def remove_waiting_request(self, room_id: str, client_id: str):
        if room_id in self.waiting_requests:
            return self.waiting_requests[room_id].pop(client_id, None)
        return None

    def get_waiting_requests(self, room_id: str):
        return list(self.waiting_requests.get(room_id, {}).values())

    def add_accepted_participant(self, room_id: str, client_id: str):
        if room_id not in self.accepted_participants:
            self.accepted_participants[room_id] = set()

        self.accepted_participants[room_id].add(client_id)

    def is_participant_accepted(self, room_id: str, client_id: str):
        return client_id in self.accepted_participants.get(room_id, set())

manager = ConnectionManager()
