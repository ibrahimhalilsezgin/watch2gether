// app/api/auth/login/route.js
import { NextResponse } from 'next/server';
const db = require('@/lib/db');

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    const result = await db.loginUser(username, password);
    const response = NextResponse.json({ success: true, ...result });
    response.cookies.set('w2g_token', result.token, { path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Giriş başarısız' }, { status: 400 });
  }
}
