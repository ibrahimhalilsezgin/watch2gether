// app/api/rooms/[id]/chat/route.js
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

    const body = await req.json();
    const text = (body.text || '').trim();
    if (!text) {
      return NextResponse.json({ error: 'Mesaj boş olamaz' }, { status: 400 });
    }

    const chatMsg = {
      username: user.username,
      text: text.slice(0, 300),
      timestamp: Date.now(),
    };

    await db.addChatMessage(id, chatMsg);

    return NextResponse.json({ success: true, message: chatMsg });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
