// app/api/auth/me/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const authHeader = req.headers.get('authorization');
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      token = req.cookies.get('w2g_token')?.value;
    }

    const user = await db.getUserByToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Giriş yapılmadı' }, { status: 401 });
    }

    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
