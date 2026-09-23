// test-e2e.js
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

async function test() {
  console.log('Starting Next.js server on port 3034 for test...');
  const env = { ...process.env, PORT: '3034', NODE_ENV: 'production' };
  const child = spawn('node', ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));

  // Wait for server to be ready
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://localhost:3034/');
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!ready) {
    child.kill();
    throw new Error('Server did not start in time');
  }

  console.log('✓ Server is responsive at http://localhost:3034/');

  // 1. Register User A (Host)
  const userA = `host_${Date.now()}`;
  const regARes = await fetch('http://localhost:3034/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userA, password: 'password123' })
  });
  const dataA = await regARes.json();
  if (!dataA.token) throw new Error('User A register failed');
  console.log('✓ Host registered:', dataA.user.username);

  // 2. Register User B (Guest)
  const userB = `guest_${Date.now()}`;
  const regBRes = await fetch('http://localhost:3034/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB, password: 'password123' })
  });
  const dataB = await regBRes.json();
  if (!dataB.token) throw new Error('User B register failed');
  console.log('✓ Guest registered:', dataB.user.username);

  // 3. User A creates Room (User A is Host)
  const roomRes = await fetch('http://localhost:3034/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${dataA.token}`
    },
    body: JSON.stringify({ name: 'Sinema Odası' })
  });
  const roomData = await roomRes.json();
  const roomId = roomData.room.id;
  console.log('✓ Room created:', roomId, roomData.room.name);

  // 4. WebSocket Test: Host and Guest connect
  const wsHost = new WebSocket('ws://localhost:3034/ws');
  const wsGuest = new WebSocket('ws://localhost:3034/ws');

  await new Promise((resolve, reject) => {
    let hostJoined = false;
    let guestJoined = false;
    let chatReceived = false;
    let syncPlayReceived = false;
    let hostPausedWhenMinimized = false;
    let heartbeatReceived = false;
    let guestRejectedAction = false;

    wsHost.on('open', () => {
      wsHost.send(JSON.stringify({ type: 'join', roomId, token: dataA.token }));
    });

    wsGuest.on('open', () => {
      wsGuest.send(JSON.stringify({ type: 'join', roomId, token: dataB.token }));
    });

    wsHost.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'init') {
        hostJoined = true;
        console.log('✓ Host joined via WebSocket');
        // Host starts playback
        wsHost.send(JSON.stringify({ type: 'action', action: 'play', time: 10.0 }));
      }
      if (msg.type === 'chat' && msg.message.text === 'selam') {
        chatReceived = true;
        console.log('✓ Host received chat from Guest');
      }
      if (msg.type === 'sync' && msg.action === 'play') {
        syncPlayReceived = true;
        console.log('✓ Host received play sync');
      }
      if (msg.type === 'heartbeat') {
        heartbeatReceived = true;
        console.log('✓ Continuous heartbeat sync received (time: ' + msg.time + ')');
        // Now simulate host minimizing window/switching tab:
        wsHost.send(JSON.stringify({
          type: 'action',
          action: 'pause',
          time: 50.0,
          reason: 'Oda sahibi sekmeyi alta aldı'
        }));
      }
    });

    wsGuest.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'init') {
        guestJoined = true;
        console.log('✓ Guest joined via WebSocket');
        // Guest sends chat
        wsGuest.send(JSON.stringify({ type: 'chat', text: 'selam' }));
        // Guest attempts unauthorized play action:
        wsGuest.send(JSON.stringify({ type: 'action', action: 'play', time: 99.0 }));
      }
      if (msg.type === 'error' && msg.message.includes('Sadece oda sahibi')) {
        guestRejectedAction = true;
        console.log('✓ Guest action blocked by server ("Sadece oda sahibi")');
      }
      if (msg.type === 'sync' && msg.action === 'pause' && msg.reason === 'Oda sahibi sekmeyi alta aldı') {
        hostPausedWhenMinimized = true;
        console.log('✓ Guest received pause notification: "Oda sahibi sekmeyi alta aldı"');
      }
    });

    const interval = setInterval(() => {
      if (chatReceived && syncPlayReceived && hostPausedWhenMinimized && heartbeatReceived && guestRejectedAction) {
        clearInterval(interval);
        wsHost.close();
        wsGuest.close();
        resolve();
      }
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      if (!hostPausedWhenMinimized || !heartbeatReceived) {
        reject(new Error(`Timeout (paused: ${hostPausedWhenMinimized}, heartbeat: ${heartbeatReceived})`));
      }
    }, 9000);
  });

  child.kill();
  console.log('✓ All tests passed: Continuous sync + Host tab minimize pause verified!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
