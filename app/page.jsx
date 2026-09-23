// app/page.jsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomName, setRoomName] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [heroTab, setHeroTab] = useState('create'); // 'create' | 'join'
  const [showModal, setShowModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [toast, setToast] = useState('');

  const showNotification = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const checkAuth = async () => {
    const token = localStorage.getItem('w2g_token');
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('w2g_token');
        setUser(null);
      }
    } catch {
      // offline / error
    }
  };

  const fetchRooms = async () => {
    try {
      setLoadingRooms(true);
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRooms(false);
    }
  };

  useEffect(() => {
    checkAuth();
    fetchRooms();
  }, []);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'İşlem başarısız');

      localStorage.setItem('w2g_token', data.token);
      setUser(data.user);
      setShowModal(false);
      setUsername('');
      setPassword('');
      showNotification(authMode === 'login' ? 'Giriş yapıldı!' : 'Kayıt başarılı!');
      fetchRooms();
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('w2g_token');
    document.cookie = 'w2g_token=; path=/; max-age=0;';
    setUser(null);
    showNotification('Çıkış yapıldı');
  };

  const handleCreateRoom = async () => {
    if (!user) {
      setAuthMode('login');
      setShowModal(true);
      showNotification('Oda açmak için giriş yapmalısınız');
      return;
    }

    const token = localStorage.getItem('w2g_token');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: roomName.trim() || `${user.username}'in Odası` })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      window.location.href = `/room/${data.room.id}`;
    } catch (err) {
      showNotification(err.message);
    }
  };

  const handleJoinRoom = (e) => {
    if (e) e.preventDefault();
    const input = joinInput.trim();
    if (!input) {
      showNotification('Lütfen oda kodu veya linki girin');
      return;
    }
    // Extract ID from full URL (e.g. http://localhost:3000/room/5261b45172a5) or raw code
    const urlMatch = input.match(/\/room\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      window.location.href = `/room/${urlMatch[1]}`;
      return;
    }
    const cleanId = input.replace(/^#/, '').trim();
    window.location.href = `/room/${cleanId}`;
  };

  return (
    <>
      {/* Navbar */}
      <nav className="navbar">
        <Link href="/" className="brand">
          <span className="brand-badge">W2G</span>
          <span>Watch2Gether</span>
        </Link>
        <div className="user-nav">
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                👤 <b>{user.username}</b>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                Çıkış Yap
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setAuthMode('login');
                  setShowModal(true);
                }}
              >
                Giriş Yap
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setAuthMode('register');
                  setShowModal(true);
                }}
              >
                Kayıt Ol
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Main Container */}
      <div className="container">
        {/* Hero Card */}
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.6rem', fontWeight: 800 }}>
            Birlikte YouTube İzle
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.8rem', maxWidth: '540px', margin: '0 auto 1.8rem' }}>
            Arkadaşlarınla anlık senkronize video oynat, durdur, ileri/geri sar ve kesintisiz sohbet et.
          </p>

          <div style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div className="tabs" style={{ justifyContent: 'center', marginBottom: '1.25rem' }}>
              <button
                className={`tab-btn ${heroTab === 'create' ? 'active' : ''}`}
                onClick={() => setHeroTab('create')}
              >
                ➕ Yeni Oda Aç
              </button>
              <button
                className={`tab-btn ${heroTab === 'join' ? 'active' : ''}`}
                onClick={() => setHeroTab('join')}
              >
                🔗 Kodu/Linkiyle Katıl
              </button>
            </div>

            {heroTab === 'create' ? (
              <form onSubmit={(e) => { e.preventDefault(); handleCreateRoom(); }} className="input-group">
                <input
                  type="text"
                  className="input"
                  placeholder="Oda Adı (ör: Film Gecesi)"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  maxLength={40}
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  Oda Aç
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoinRoom} className="input-group">
                <input
                  type="text"
                  className="input"
                  placeholder="Oda Kodu veya Linki yapıştır (ör: 975b04...)"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                />
                <button type="submit" className="btn btn-accent" style={{ whiteSpace: 'nowrap' }}>
                  Odaya Katıl
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Active Rooms */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>Aktif Odalar</h2>
            <button className="btn btn-secondary btn-sm" onClick={fetchRooms}>
              🔄 Yenile
            </button>
          </div>

          {loadingRooms ? (
            <p style={{ color: 'var(--text-muted)' }}>Odalar yükleniyor...</p>
          ) : rooms.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>
              Henüz aktif oda bulunmuyor. Yukarıdan ilk odayı sen oluştur!
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {rooms.map((r) => (
                <div
                  key={r.id}
                  className="card"
                  style={{
                    marginBottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    borderColor: 'var(--border-color)',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.4rem' }}>{r.name}</h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Kurucu: <b>{r.creator}</b>
                      </span>
                      <span style={{ fontSize: '0.75rem', background: 'var(--bg-input)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--accent)' }}>
                        #{r.id}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginBottom: '1rem' }}>
                      🟢 <b>{r.onlineUsers}</b> kişi izliyor
                    </div>
                  </div>
                  <Link href={`/room/${r.id}`} className="btn btn-primary btn-sm" style={{ textDecoration: 'none', width: '100%' }}>
                    Odaya Katıl
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.2rem' }}>
                {authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div className="tabs">
              <button
                className={`tab-btn ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                }}
              >
                Giriş Yap
              </button>
              <button
                className={`tab-btn ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('register');
                  setAuthError('');
                }}
              >
                Kayıt Ol
              </button>
            </div>

            <form onSubmit={handleAuthSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Kullanıcı Adı
                </label>
                <input
                  type="text"
                  className="input"
                  required
                  minLength={3}
                  placeholder="Kullanıcı adı"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Şifre
                </label>
                <input
                  type="password"
                  className="input"
                  required
                  minLength={4}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                {authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
              </button>

              {authError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.75rem', textAlign: 'center' }}>
                  {authError}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Global Toast */}
      {toast && <div className="toast" style={{ display: 'block' }}>{toast}</div>}
    </>
  );
}
