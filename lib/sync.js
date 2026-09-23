// lib/sync.js - Central Room Sync State
const activeRooms = global.__w2g_activeRooms || new Map();
global.__w2g_activeRooms = activeRooms;

function getOrCreateRoom(roomId) {
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, {
      videoId: 'jfKfPfyJRdk', // Default: lofi hip hop
      state: 'paused',
      time: 0,
      lastSync: Date.now(),
      clients: new Set(),
      messages: [],
    });
  }
  return activeRooms.get(roomId);
}

function calculateCurrentTime(room) {
  if (room.state === 'playing') {
    const elapsed = (Date.now() - room.lastSync) / 1000;
    return room.time + elapsed;
  }
  return room.time;
}

function broadcastToRoom(room, message, excludeWs = null) {
  const payload = JSON.stringify(message);
  for (const client of room.clients) {
    if (client.ws !== excludeWs && client.ws.readyState === 1) { // 1 = OPEN
      client.ws.send(payload);
    }
  }
}

module.exports = {
  activeRooms,
  getOrCreateRoom,
  calculateCurrentTime,
  broadcastToRoom,
};
