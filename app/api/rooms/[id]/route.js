// app/api/rooms/[id]/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const room = db.getRoom(id);
    if (!room) {
      return NextResponse.json({ error: 'Oda bulunamadı' }, { status: 404 });
    }
    return NextResponse.json({ room });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
