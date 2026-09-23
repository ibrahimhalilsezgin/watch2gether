// server.js - Custom Next.js + WebSocket Server
const { createServer } = require('node:http');
const { parse } = require('node:url');
const next = require('next');
const { WebSocketServer } = require('ws');
const db = require('./lib/db');
const { getOrCreateRoom, calculateCurrentTime, broadcastToRoom, activeRooms } = require('./lib/sync');

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url);

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Allow other upgrades (e.g. Next.js HMR on /_next/webpack-hmr) to proceed untouched
  });

  wss.on('connection', (ws) => {
    let clientInfo = {
      ws,
      roomId: null,
      userId: null,
      username: null,
    };

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);

        // 1. Join Room
        if (data.type === 'join') {
          const { roomId, token } = data;
          const user = db.getUserByToken(token);
          if (!user) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Yetkisiz oturum' }));
          }

          const roomMeta = db.getRoom(roomId);
          if (!roomMeta) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Oda bulunamadı' }));
          }

          clientInfo.roomId = roomId;
          clientInfo.userId = user.id;
          clientInfo.username = user.username;

          const roomState = getOrCreateRoom(roomId);
          roomState.clients.add(clientInfo);

          // Send initial synchronized state to new joiner
          ws.send(JSON.stringify({
            type: 'init',
            room: { id: roomMeta.id, name: roomMeta.name, creator: roomMeta.creator },
            videoId: roomState.videoId,
            state: roomState.state,
            time: calculateCurrentTime(roomState),
            lastSync: roomState.lastSync,
            users: Array.from(roomState.clients).map((c) => c.username),
            messages: roomState.messages,
          }));

          // Notify room members
          broadcastToRoom(roomState, {
            type: 'user_joined',
            username: clientInfo.username,
            users: Array.from(roomState.clients).map((c) => c.username),
          }, ws);
          return;
        }

        // Must be in a room for subsequent actions
        if (!clientInfo.roomId) return;
        const roomState = getOrCreateRoom(clientInfo.roomId);

        // 2. Playback Action: play, pause, seek, load
        if (data.type === 'action') {
          const { action, time, videoId } = data;
          const now = Date.now();

          if (action === 'load' && videoId) {
            roomState.videoId = videoId;
            roomState.time = 0;
            roomState.state = 'playing';
            roomState.lastSync = now;
          } else if (action === 'play') {
            roomState.state = 'playing';
            roomState.time = typeof time === 'number' ? time : roomState.time;
            roomState.lastSync = now;
          } else if (action === 'pause') {
            roomState.state = 'paused';
            roomState.time = typeof time === 'number' ? time : calculateCurrentTime(roomState);
            roomState.lastSync = now;
          } else if (action === 'seek') {
            roomState.time = typeof time === 'number' ? time : 0;
            roomState.lastSync = now;
          }

          // Broadcast to everyone in room
          broadcastToRoom(roomState, {
            type: 'sync',
            action,
            videoId: roomState.videoId,
            state: roomState.state,
            time: roomState.time,
            lastSync: roomState.lastSync,
            actor: clientInfo.username,
            reason: data.reason || null,
          });
          return;
        }

        // 3. Live Chat
        if (data.type === 'chat') {
          const text = (data.text || '').trim();
          if (!text) return;

          const chatMsg = {
            username: clientInfo.username,
            text: text.slice(0, 300),
            timestamp: Date.now(),
          };

          roomState.messages.push(chatMsg);
          if (roomState.messages.length > 50) roomState.messages.shift();

          broadcastToRoom(roomState, {
            type: 'chat',
            message: chatMsg,
          });
          return;
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      if (clientInfo.roomId) {
        const roomState = getOrCreateRoom(clientInfo.roomId);
        roomState.clients.delete(clientInfo);
        broadcastToRoom(roomState, {
          type: 'user_left',
          username: clientInfo.username,
          users: Array.from(roomState.clients).map((c) => c.username),
        });
      }
    });
  });

  // Periodic heartbeat: keep all connected clients continuously in lockstep
  setInterval(() => {
    const now = Date.now();
    for (const [, roomState] of activeRooms.entries()) {
      if (roomState.state === 'playing' && roomState.clients.size > 0) {
        const curTime = calculateCurrentTime(roomState);
        broadcastToRoom(roomState, {
          type: 'heartbeat',
          time: curTime,
          state: 'playing',
          lastSync: now,
        });
      }
    }
  }, 2500);

  server.listen(port, () => {
    console.log(`> Watch2Gether Next.js running on http://localhost:${port}`);
  });
});
