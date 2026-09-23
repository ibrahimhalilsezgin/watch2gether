// lib/db.js - Unified MongoDB & SQLite Database Layer
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {}
}

const { MongoClient } = require('mongodb');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

// ----------------- MongoDB Implementation -----------------
async function getMongoDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!global.__mongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    global.__mongoClientPromise = client.connect();
  }
  const client = await global.__mongoClientPromise;
  return client.db(process.env.MONGODB_DB_NAME || 'watch2gether');
}

async function registerUserMongo(username, password) {
  const db = await getMongoDb();
  const trimmed = (username || '').trim();
  if (!trimmed || trimmed.length < 3) throw new Error('Kullanıcı adı en az 3 karakter olmalı');
  if (!password || password.length < 4) throw new Error('Şifre en az 4 karakter olmalı');

  const usersCol = db.collection('users');
  const existing = await usersCol.findOne({ username: { $regex: new RegExp(`^${trimmed}$`, 'i') } });
  if (existing) throw new Error('Bu kullanıcı adı zaten alınmış');

  const id = randomBytes(8).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const now = Date.now();

  await usersCol.insertOne({
    _id: id,
    username: trimmed,
    password_hash: hash,
    salt,
    created_at: now,
  });

  const token = randomBytes(32).toString('hex');
  const sessionsCol = db.collection('sessions');
  await sessionsCol.insertOne({
    _id: token,
    user_id: id,
    username: trimmed,
    created_at: now,
  });

  return { token, user: { id, username: trimmed } };
}

async function loginUserMongo(username, password) {
  const db = await getMongoDb();
  const trimmed = (username || '').trim();
  const usersCol = db.collection('users');
  const user = await usersCol.findOne({ username: { $regex: new RegExp(`^${trimmed}$`, 'i') } });
  if (!user) throw new Error('Kullanıcı adı veya şifre hatalı');

  const inputHash = hashPassword(password, user.salt);
  const hashBuf = Buffer.from(user.password_hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  if (hashBuf.length !== inputBuf.length || !timingSafeEqual(hashBuf, inputBuf)) {
    throw new Error('Kullanıcı adı veya şifre hatalı');
  }

  const token = randomBytes(32).toString('hex');
  const sessionsCol = db.collection('sessions');
  await sessionsCol.insertOne({
    _id: token,
    user_id: user._id,
    username: user.username,
    created_at: Date.now(),
  });

  return { token, user: { id: user._id, username: user.username } };
}

async function getUserByTokenMongo(token) {
  if (!token) return null;
  const db = await getMongoDb();
  const session = await db.collection('sessions').findOne({ _id: token });
  if (!session) return null;
  return { id: session.user_id, username: session.username };
}

async function createRoomMongo(name, creatorId) {
  const db = await getMongoDb();
  const trimmed = (name || '').trim() || 'Oda';
  const id = randomBytes(6).toString('hex');
  const user = await db.collection('users').findOne({ _id: creatorId });

  const room = {
    _id: id,
    name: trimmed,
    creator_id: creatorId,
    creator: user ? user.username : 'Bilinmeyen',
    created_at: Date.now(),
  };

  await db.collection('rooms').insertOne(room);
  return { id, name: trimmed };
}

async function getRoomsMongo() {
  const db = await getMongoDb();
  const rooms = await db.collection('rooms').find().sort({ created_at: -1 }).limit(50).toArray();
  return rooms.map(r => ({
    id: r._id,
    name: r.name,
    creator: r.creator,
    creator_id: r.creator_id,
    created_at: r.created_at,
  }));
}

async function getRoomMongo(id) {
  const db = await getMongoDb();
  const r = await db.collection('rooms').findOne({ _id: id });
  if (!r) return null;
  return {
    id: r._id,
    name: r.name,
    creator: r.creator,
    creator_id: r.creator_id,
    created_at: r.created_at,
  };
}

async function updateRoomActionMongo(id, { action, time, videoId, reason, actor }) {
  const db = await getMongoDb();
  const update = {
    $set: {
      lastSync: Date.now(),
      actor,
      ...(reason ? { reason } : {})
    }
  };
  if (action === 'load' && videoId) {
    update.$set.videoId = videoId;
    update.$set.time = 0;
    update.$set.state = 'playing';
  } else if (action === 'play') {
    update.$set.state = 'playing';
    update.$set.time = typeof time === 'number' ? time : 0;
  } else if (action === 'pause') {
    update.$set.state = 'paused';
    update.$set.time = typeof time === 'number' ? time : 0;
  } else if (action === 'seek') {
    update.$set.time = typeof time === 'number' ? time : 0;
  }
  await db.collection('rooms').updateOne({ _id: id }, update);
}

async function addChatMessageMongo(id, message) {
  const db = await getMongoDb();
  await db.collection('rooms').updateOne(
    { _id: id },
    { $push: { messages: { $each: [message], $slice: -50 } } }
  );
}

async function updatePresenceMongo(id, username) {
  const db = await getMongoDb();
  await db.collection('rooms').updateOne(
    { _id: id },
    { $set: { [`presence.${username}`]: Date.now() } }
  );
}

async function getRoomSyncStateMongo(id, username) {
  const db = await getMongoDb();
  if (username) {
    await updatePresenceMongo(id, username);
  }
  const r = await db.collection('rooms').findOne({ _id: id });
  if (!r) return null;

  const now = Date.now();
  const activeUsers = [];
  if (r.presence) {
    for (const [uname, lastSeen] of Object.entries(r.presence)) {
      if (now - lastSeen < 12000) {
        activeUsers.push(uname);
      }
    }
  }

  let calculatedTime = r.time || 0;
  if (r.state === 'playing' && r.lastSync) {
    const elapsed = (now - r.lastSync) / 1000;
    calculatedTime += elapsed;
  }

  return {
    room: { id: r._id, name: r.name, creator: r.creator },
    videoId: r.videoId || 'jfKfPfyJRdk',
    state: r.state || 'paused',
    time: calculatedTime,
    lastSync: r.lastSync || now,
    actor: r.actor || '',
    reason: r.reason || null,
    users: activeUsers,
    messages: r.messages || [],
  };
}

// ----------------- SQLite Fallback -----------------
let sqliteInstance = null;
function getSqlite() {
  if (!sqliteInstance) {
    const { DatabaseSync } = eval('require')('node:sqlite');
    const isVercel = Boolean(process.env.VERCEL);
    const dbDir = isVercel ? os.tmpdir() : process.cwd();
    const dbPath = path.join(dbDir, 'watch2gether.db');
    sqliteInstance = new DatabaseSync(dbPath);

    sqliteInstance.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(creator_id) REFERENCES users(id)
      );
    `);
  }
  return sqliteInstance;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function registerUserSqlite(username, password) {
  const db = getSqlite();
  const trimmed = (username || '').trim();
  if (!trimmed || trimmed.length < 3) throw new Error('Kullanıcı adı en az 3 karakter olmalı');
  if (!password || password.length < 4) throw new Error('Şifre en az 4 karakter olmalı');

  const existing = db.prepare(`SELECT * FROM users WHERE username = ?`).get(trimmed);
  if (existing) throw new Error('Bu kullanıcı adı zaten alınmış');

  const id = randomBytes(8).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const now = Date.now();

  db.prepare(`INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, trimmed, hash, salt, now);

  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(token, id, now);

  return { token, user: { id, username: trimmed } };
}

function loginUserSqlite(username, password) {
  const db = getSqlite();
  const trimmed = (username || '').trim();
  const user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(trimmed);
  if (!user) throw new Error('Kullanıcı adı veya şifre hatalı');

  const inputHash = hashPassword(password, user.salt);
  const hashBuf = Buffer.from(user.password_hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  if (hashBuf.length !== inputBuf.length || !timingSafeEqual(hashBuf, inputBuf)) {
    throw new Error('Kullanıcı adı veya şifre hatalı');
  }

  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(token, user.id, Date.now());

  return { token, user: { id: user.id, username: user.username } };
}

function getUserByTokenSqlite(token) {
  if (!token) return null;
  const db = getSqlite();
  const session = db.prepare(`SELECT s.token, u.id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`).get(token);
  return session || null;
}

function createRoomSqlite(name, creatorId) {
  const db = getSqlite();
  const trimmed = (name || '').trim() || 'Oda';
  const id = randomBytes(6).toString('hex');
  db.prepare(`INSERT INTO rooms (id, name, creator_id, created_at) VALUES (?, ?, ?, ?)`).run(id, trimmed, creatorId, Date.now());
  return { id, name: trimmed };
}

function getRoomsSqlite() {
  const db = getSqlite();
  return db.prepare(`SELECT r.id, r.name, r.created_at, u.username as creator FROM rooms r JOIN users u ON r.creator_id = u.id ORDER BY r.created_at DESC LIMIT 50`).all();
}

function getRoomSqlite(id) {
  const db = getSqlite();
  return db.prepare(`SELECT r.id, r.name, r.creator_id, u.username as creator FROM rooms r JOIN users u ON r.creator_id = u.id WHERE r.id = ?`).get(id);
}

function updateRoomActionSqlite(id, { action, time, videoId, reason, actor }) {
  const { getOrCreateRoom } = require('./sync');
  const room = getOrCreateRoom(id);
  const now = Date.now();
  room.lastSync = now;
  room.actor = actor;
  if (reason) room.reason = reason;
  if (action === 'load' && videoId) {
    room.videoId = videoId;
    room.time = 0;
    room.state = 'playing';
  } else if (action === 'play') {
    room.state = 'playing';
    room.time = typeof time === 'number' ? time : 0;
  } else if (action === 'pause') {
    room.state = 'paused';
    room.time = typeof time === 'number' ? time : 0;
  } else if (action === 'seek') {
    room.time = typeof time === 'number' ? time : 0;
  }
}

function addChatMessageSqlite(id, message) {
  const { getOrCreateRoom } = require('./sync');
  const room = getOrCreateRoom(id);
  room.messages.push(message);
  if (room.messages.length > 50) room.messages.shift();
}

function getRoomSyncStateSqlite(id, username) {
  const { getOrCreateRoom, calculateCurrentTime } = require('./sync');
  const r = getRoomSqlite(id);
  if (!r) return null;
  const state = getOrCreateRoom(id);
  if (!state.presence) state.presence = new Map();
  if (username) state.presence.set(username, Date.now());

  const now = Date.now();
  const activeUsers = [];
  for (const [uname, lastSeen] of state.presence.entries()) {
    if (now - lastSeen < 12000) activeUsers.push(uname);
  }

  return {
    room: { id: r.id, name: r.name, creator: r.creator },
    videoId: state.videoId,
    state: state.state,
    time: calculateCurrentTime(state),
    lastSync: state.lastSync,
    actor: state.actor || '',
    reason: state.reason || null,
    users: activeUsers,
    messages: state.messages,
  };
}

// ----------------- Unified Exports -----------------
module.exports = {
  async registerUser(username, password) {
    if (process.env.MONGODB_URI) return registerUserMongo(username, password);
    return registerUserSqlite(username, password);
  },
  async loginUser(username, password) {
    if (process.env.MONGODB_URI) return loginUserMongo(username, password);
    return loginUserSqlite(username, password);
  },
  async getUserByToken(token) {
    if (process.env.MONGODB_URI) return getUserByTokenMongo(token);
    return getUserByTokenSqlite(token);
  },
  async createRoom(name, creatorId) {
    if (process.env.MONGODB_URI) return createRoomMongo(name, creatorId);
    return createRoomSqlite(name, creatorId);
  },
  async getRooms() {
    if (process.env.MONGODB_URI) return getRoomsMongo();
    return getRoomsSqlite();
  },
  async getRoom(id) {
    if (process.env.MONGODB_URI) return getRoomMongo(id);
    return getRoomSqlite(id);
  },
  async updateRoomAction(id, data) {
    if (process.env.MONGODB_URI) return updateRoomActionMongo(id, data);
    return updateRoomActionSqlite(id, data);
  },
  async addChatMessage(id, message) {
    if (process.env.MONGODB_URI) return addChatMessageMongo(id, message);
    return addChatMessageSqlite(id, message);
  },
  async getRoomSyncState(id, username) {
    if (process.env.MONGODB_URI) return getRoomSyncStateMongo(id, username);
    return getRoomSyncStateSqlite(id, username);
  },
};
