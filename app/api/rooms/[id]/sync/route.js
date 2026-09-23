// app/api/rooms/[id]/sync/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization');
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      token = req.cookies.get('w2g_token')?.value;
    }

    const user = token ? await db.getUserByToken(token) : null;
    const syncState = await db.getRoomSyncState(id, user?.username);

    if (!syncState) {
      return NextResponse.json({ error: 'Oda bulunamadı' }, { status: 404 });
    }

    return NextResponse.json(syncState);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
