// app/api/rooms/[id]/action/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization');
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      token = req.cookies.get('w2g_token')?.value;
    }

    const user = await db.getUserByToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Yetkisiz oturum' }, { status: 401 });
    }

    const room = await db.getRoom(id);
    if (!room) {
      return NextResponse.json({ error: 'Oda bulunamadı' }, { status: 404 });
    }

    if (user.username !== room.creator) {
      return NextResponse.json({ error: 'Sadece oda sahibi videoyu kontrol edebilir 🔒' }, { status: 403 });
    }

    const body = await req.json();
    const { action, time, videoId, reason } = body;

    await db.updateRoomAction(id, {
      action,
      time,
      videoId,
      reason,
      actor: user.username,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
