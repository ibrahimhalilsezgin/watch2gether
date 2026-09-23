// app/api/rooms/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');
const { activeRooms } = require('@/lib/sync');

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rooms = db.getRooms();
    const roomsWithActivity = rooms.map(r => {
      const state = activeRooms.get(r.id);
      return {
        ...r,
        onlineUsers: state ? state.clients.size : 0,
        currentVideo: state ? state.videoId : null,
      };
    });
    return NextResponse.json({ rooms: roomsWithActivity });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization');
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      token = req.cookies.get('w2g_token')?.value;
    }

    const user = db.getUserByToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Oda açmak için giriş yapmalısınız' }, { status: 401 });
    }

    const body = await req.json();
    const room = db.createRoom(body.name, user.id);
    return NextResponse.json({ success: true, room }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
