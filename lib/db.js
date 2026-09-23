// lib/db.js - Native SQLite via node:sqlite
const { DatabaseSync } = eval('require')('node:sqlite');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const path = require('node:path');

// Global singleton to prevent re-opening database in Next.js dev reloads
let dbInstance = global.__w2g_db;

if (!dbInstance) {
  const dbPath = path.join(process.cwd(), 'watch2gether.db');
  dbInstance = new DatabaseSync(dbPath);
  global.__w2g_db = dbInstance;

  dbInstance.exec(`
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

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

const userQueries = {
  create: dbInstance.prepare(`INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`),
  findByUsername: dbInstance.prepare(`SELECT * FROM users WHERE username = ?`),
  findById: dbInstance.prepare(`SELECT id, username, created_at FROM users WHERE id = ?`),
};

const sessionQueries = {
  create: dbInstance.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`),
  find: dbInstance.prepare(`SELECT s.token, u.id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`),
  delete: dbInstance.prepare(`DELETE FROM sessions WHERE token = ?`),
};

const roomQueries = {
  create: dbInstance.prepare(`INSERT INTO rooms (id, name, creator_id, created_at) VALUES (?, ?, ?, ?)`),
  list: dbInstance.prepare(`SELECT r.id, r.name, r.created_at, u.username as creator FROM rooms r JOIN users u ON r.creator_id = u.id ORDER BY r.created_at DESC LIMIT 50`),
  findById: dbInstance.prepare(`SELECT r.id, r.name, r.creator_id, u.username as creator FROM rooms r JOIN users u ON r.creator_id = u.id WHERE r.id = ?`),
};

function registerUser(username, password) {
  const trimmed = (username || '').trim();
  if (!trimmed || trimmed.length < 3) throw new Error('Kullanıcı adı en az 3 karakter olmalı');
  if (!password || password.length < 4) throw new Error('Şifre en az 4 karakter olmalı');

  const existing = userQueries.findByUsername.get(trimmed);
  if (existing) throw new Error('Bu kullanıcı adı zaten alınmış');

  const id = randomBytes(8).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const now = Date.now();

  userQueries.create.run(id, trimmed, hash, salt, now);

  const token = randomBytes(32).toString('hex');
  sessionQueries.create.run(token, id, now);

  return { token, user: { id, username: trimmed } };
}

function loginUser(username, password) {
  const trimmed = (username || '').trim();
  const user = userQueries.findByUsername.get(trimmed);
  if (!user) throw new Error('Kullanıcı adı veya şifre hatalı');

  const inputHash = hashPassword(password, user.salt);
  const hashBuf = Buffer.from(user.password_hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  if (hashBuf.length !== inputBuf.length || !timingSafeEqual(hashBuf, inputBuf)) {
    throw new Error('Kullanıcı adı veya şifre hatalı');
  }

  const token = randomBytes(32).toString('hex');
  sessionQueries.create.run(token, user.id, Date.now());

  return { token, user: { id: user.id, username: user.username } };
}

function getUserByToken(token) {
  if (!token) return null;
  return sessionQueries.find.get(token) || null;
}

function createRoom(name, creatorId) {
  const trimmed = (name || '').trim() || 'Oda';
  const id = randomBytes(6).toString('hex');
  roomQueries.create.run(id, trimmed, creatorId, Date.now());
  return { id, name: trimmed };
}

function getRooms() {
  return roomQueries.list.all();
}

function getRoom(id) {
  return roomQueries.findById.get(id);
}

module.exports = {
  db: dbInstance,
  registerUser,
  loginUser,
  getUserByToken,
  createRoom,
  getRooms,
  getRoom,
};
