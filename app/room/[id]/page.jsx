// app/room/[id]/page.jsx
'use client';

import { useState, useEffect, useRef, use } from 'react';
import Link from 'next/link';

function parseYouTubeId(input) {
  if (!input) return null;
  const str = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const p = (n) => (n < 10 ? '0' + n : n);
  return hrs > 0 ? `${hrs}:${p(mins)}:${p(secs)}` : `${p(mins)}:${p(secs)}`;
}

export default function RoomPage({ params }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;

  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'users'
  const [syncStatus, setSyncStatus] = useState({ text: '00:00 (Hazır)', playing: false, actor: '' });
  const [toast, setToast] = useState('');

  const isHost = Boolean(user && room && user.username.toLowerCase() === room.creator.toLowerCase());

  // Auth modal for unauthenticated joiners
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const wsRef = useRef(null);
  const isRemoteChangeRef = useRef(false);
  const remoteTimerRef = useRef(null);
  const currentVideoIdRef = useRef('aqz-KE-bpKQ');
  const pendingStateRef = useRef(null);
  const chatBottomRef = useRef(null);
  const videoContainerRef = useRef(null);
  const syncModeRef = useRef('ws');
  const pollTimerRef = useRef(null);
  const lastReasonRef = useRef(null);
  const lastSeekTimeRef = useRef(0);

  const showNotification = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const setRemoteFlag = (duration = 1200) => {
    isRemoteChangeRef.current = true;
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
    remoteTimerRef.current = setTimeout(() => {
      isRemoteChangeRef.current = false;
    }, duration);
  };

  // Scroll chat
  useEffect(() => {
    if (activeTab === 'chat' && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  // When room owner switches tab or minimizes window, auto-pause video for everyone
  useEffect(() => {
    if (!isHost) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (playerRef.current && playerReadyRef.current) {
          const state = playerRef.current.getPlayerState ? playerRef.current.getPlayerState() : -1;
          if (state === window.YT.PlayerState.PLAYING) {
            const time = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
            playerRef.current?.pauseVideo?.();
            sendAction('pause', time, null, 'Oda sahibi sekmeyi alta aldı');
            showNotification('Sekmeyi alta aldınız, video herkes için durduruldu ⏸️');
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost]);

  // Fetch room metadata immediately
  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.room) setRoom(data.room);
      })
      .catch(() => {});
  }, [roomId]);

  // Auth Check
  useEffect(() => {
    const token = localStorage.getItem('w2g_token');
    if (!token) {
      setShowAuthModal(true);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Yetkisiz');
      })
      .then((data) => {
        setUser(data.user);
        initWebSocket(token);
      })
      .catch(() => {
        localStorage.removeItem('w2g_token');
        setShowAuthModal(true);
      });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [roomId]);

  // Initialize YouTube Player
  useEffect(() => {
    let isCancelled = false;

    const setupPlayer = () => {
      if (isCancelled) return;
      if (!window.YT || !window.YT.Player) {
        setTimeout(setupPlayer, 150);
        return;
      }

      const container = videoContainerRef.current;
      if (!container) {
        setTimeout(setupPlayer, 150);
        return;
      }

      // Ensure stable target element inside wrapper
      let target = document.getElementById('yt-player-target');
      if (!target) {
        target = document.createElement('div');
        target.id = 'yt-player-target';
        container.innerHTML = '';
        container.appendChild(target);
      }

      const initialVideo = pendingStateRef.current?.videoId || currentVideoIdRef.current || 'aqz-KE-bpKQ';
      try {
        new window.YT.Player('yt-player-target', {
          videoId: initialVideo,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : undefined,
          },
          events: {
            onReady: (event) => {
              if (isCancelled) return;
              playerRef.current = event.target;
              playerReadyRef.current = true;
              if (pendingStateRef.current) {
                applyRoomState(pendingStateRef.current);
                pendingStateRef.current = null;
              }
            },
            onStateChange: handlePlayerStateChange,
          },
        });
      } catch (e) {
        console.error('YT init error:', e);
      }
    };

    setupPlayer();

    return () => {
      isCancelled = true;
      playerReadyRef.current = false;
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch {}
      }
      playerRef.current = null;
    };
  }, []);

  const handlePlayerStateChange = (event) => {
    if (!playerReadyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isRemoteChangeRef.current) return;

    // Sadece oda sahibi video akışını değiştirebilir
    if (!isHost) {
      return;
    }

    const time = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;

    if (event.data === window.YT.PlayerState.PLAYING) {
      sendAction('play', time);
      setSyncStatus({ text: `${formatTime(time)} (Oynatılıyor)`, playing: true, actor: 'Sen' });
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      sendAction('pause', time);
      setSyncStatus({ text: `${formatTime(time)} (Durduruldu)`, playing: false, actor: 'Sen' });
    }
  };

  const sendAction = (action, time, videoId, reason = null) => {
    if (!isHost) {
      showNotification('Sadece oda sahibi videoyu kontrol edebilir 🔒');
      return;
    }

    const payload = {
      action,
      time: typeof time === 'number' ? time : playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0,
      videoId,
      reason,
    };

    if (syncModeRef.current === 'ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'action', ...payload }));
    } else {
      const token = localStorage.getItem('w2g_token');
      fetch(`/api/rooms/${roomId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }).catch(console.error);
    }
  };

  const applyRoomState = (data) => {
    if (!playerRef.current || !playerReadyRef.current) {
      pendingStateRef.current = data;
      return;
    }

    setRemoteFlag();

    if (data.reason) {
      if (data.reason !== lastReasonRef.current) {
        lastReasonRef.current = data.reason;
        showNotification(`${data.reason} (${data.actor})`);
      }
    } else {
      lastReasonRef.current = null;
    }

    // Change video if different from current video ID or loaded YouTube iframe video
    const activeYtId = playerRef.current?.getVideoData?.()?.video_id;
    if (data.videoId && (data.videoId !== currentVideoIdRef.current || data.videoId !== activeYtId)) {
      currentVideoIdRef.current = data.videoId;
      playerRef.current?.loadVideoById?.(data.videoId, data.time || 0);
    }

    // Target playback time from server
    const targetTime = typeof data.time === 'number' ? data.time : 0;
    const localTime = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;

    // HOST NEVER SEEKS FROM SYNC (Host is master clock)
    if (isHost) {
      setSyncStatus({
        text: `${formatTime(localTime)} (${data.state === 'playing' ? 'Oynatılıyor' : 'Durduruldu'})`,
        playing: data.state === 'playing',
        actor: 'Sen (Host)',
      });
      return;
    }

    // GUEST SYNC LOGIC
    const drift = Math.abs(localTime - targetTime);
    const now = Date.now();

    // Only hard-seek if drift is noticeable (> 0.8s) and throttled
    if (drift > 0.8 && (now - lastSeekTimeRef.current > 2000)) {
      lastSeekTimeRef.current = now;
      setRemoteFlag(1000);
      playerRef.current?.seekTo?.(targetTime, true);
    }

    if (data.state === 'playing') {
      const playerState = playerRef.current?.getPlayerState?.();
      if (playerState !== window.YT.PlayerState.PLAYING && playerState !== window.YT.PlayerState.BUFFERING) {
        setRemoteFlag(1500);
        playerRef.current?.playVideo?.();
      }
      setSyncStatus({
        text: `${formatTime(targetTime)} (Oynatılıyor)`,
        playing: true,
        actor: data.actor || '',
      });
    } else if (data.state === 'paused') {
      const playerState = playerRef.current?.getPlayerState?.();
      if (playerState === window.YT.PlayerState.PLAYING) {
        setRemoteFlag(1500);
        playerRef.current?.pauseVideo?.();
      }
      setSyncStatus({
        text: `${formatTime(targetTime)} (Durduruldu)`,
        playing: false,
        actor: data.actor || '',
      });
    }
  };

  const startHttpPolling = (token) => {
    if (pollTimerRef.current) return;
    syncModeRef.current = 'http';
    console.log('[Sync] HTTP Sync moduna geçildi (Serverless uyumlu).');

    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      // Host oynatırken gerçek zaman damgasını her 2 poll'da bir (~2s) sunucuya günceller
      if (isHost && playerRef.current?.getPlayerState?.() === window.YT.PlayerState.PLAYING) {
        if (pollCount % 2 === 0) {
          const curTime = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
          sendAction('ping', curTime);
        }
      }

      try {
        const res = await fetch(`/api/rooms/${roomId}/sync`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setRoom(data.room);
          setUsers(data.users || []);
          if (data.messages) setMessages(data.messages);
          applyRoomState(data);
        }
      } catch (err) {
        // Sessizce sonraki döngüde tekrar dene
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 1000);
  };

  const initWebSocket = (token) => {
    let wsConnected = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        wsConnected = true;
        syncModeRef.current = 'ws';
        ws.send(JSON.stringify({ type: 'join', roomId, token }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'init') {
            setRoom(msg.room);
            setUsers(msg.users || []);
            if (msg.messages) setMessages(msg.messages);
            if (msg.videoId) currentVideoIdRef.current = msg.videoId;
            applyRoomState(msg);
          } else if (msg.type === 'sync') {
            applyRoomState(msg);
          } else if (msg.type === 'heartbeat') {
            // Host asla heartbeat ile geriye/ileriye sarılmaz (Host master saattir)
            if (isHost) return;
            if (playerRef.current && playerReadyRef.current) {
              const targetTime = msg.time || 0;
              const localTime = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
              const drift = Math.abs(localTime - targetTime);
              const now = Date.now();

              // Sadece 0.8s üzeri gerçek kaymalarda ve en fazla 2 saniyede bir sarma yap
              if (drift > 0.8 && (now - lastSeekTimeRef.current > 2000)) {
                lastSeekTimeRef.current = now;
                setRemoteFlag(1000);
                playerRef.current?.seekTo?.(targetTime, true);
              }

              if (msg.state === 'playing') {
                const playerState = playerRef.current?.getPlayerState ? playerRef.current.getPlayerState() : -1;
                if (playerState !== window.YT.PlayerState.PLAYING && playerState !== window.YT.PlayerState.BUFFERING) {
                  setRemoteFlag(1500);
                  playerRef.current?.playVideo?.();
                }
              }
            }
          } else if (msg.type === 'chat') {
            setMessages((prev) => [...prev, msg.message]);
          } else if (msg.type === 'user_joined') {
            setUsers(msg.users || []);
            showNotification(`${msg.username} odaya katıldı`);
          } else if (msg.type === 'user_left') {
            setUsers(msg.users || []);
            showNotification(`${msg.username} odadan ayrıldı`);
          } else if (msg.type === 'error') {
            showNotification(`Hata: ${msg.message}`);
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onerror = () => {
        if (!wsConnected) {
          // Vercel serverless ortamında WS olmadığı için HTTP moduna geç
          startHttpPolling(token);
        }
      };

      ws.onclose = () => {
        if (!wsConnected) {
          startHttpPolling(token);
        } else {
          const curToken = localStorage.getItem('w2g_token');
          if (curToken) {
            setTimeout(() => initWebSocket(curToken), 2000);
          }
        }
      };
    } catch {
      startHttpPolling(token);
    }
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;

    if (syncModeRef.current === 'ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat', text }));
    } else {
      const token = localStorage.getItem('w2g_token');
      fetch(`/api/rooms/${roomId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text })
      }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.message) {
            setMessages((prev) => [...prev, data.message]);
          }
        }
      }).catch(console.error);
    }
    setChatInput('');
  };

  const handleVideoChange = (e) => {
    e.preventDefault();
    const id = parseYouTubeId(videoUrlInput);
    if (!id) {
      showNotification('Geçersiz YouTube linki veya ID');
      return;
    }
    currentVideoIdRef.current = id;
    playerRef.current?.loadVideoById?.(id, 0);
    sendAction('load', 0, id);
    setVideoUrlInput('');
    showNotification('Video güncelleniyor...');
  };

  const togglePlayPause = () => {
    if (!playerRef.current || !playerReadyRef.current) return;
    const state = playerRef.current?.getPlayerState ? playerRef.current.getPlayerState() : -1;
    const time = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
    if (state === window.YT.PlayerState.PLAYING) {
      playerRef.current?.pauseVideo?.();
      sendAction('pause', time);
    } else {
      playerRef.current?.playVideo?.();
      sendAction('play', time);
    }
  };

  const seekRelative = (seconds) => {
    if (!playerRef.current || !playerReadyRef.current) return;
    const current = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
    const target = Math.max(0, current + seconds);
    playerRef.current?.seekTo?.(target, true);
    sendAction('seek', target);
  };

  const forceSync = () => {
    if (!playerRef.current || !playerReadyRef.current) return;
    const time = playerRef.current?.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
    const state = playerRef.current?.getPlayerState ? playerRef.current.getPlayerState() : -1;
    const isPlaying = state === window.YT.PlayerState.PLAYING;
    sendAction(isPlaying ? 'play' : 'pause', time);
    showNotification('Senkronizasyon sinyali gönderildi');
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showNotification('Oda bağlantısı kopyalandı!');
    }).catch(() => {
      showNotification('Kopyalama başarısız');
    });
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'İşlem başarısız');

      localStorage.setItem('w2g_token', data.token);
      setUser(data.user);
      setShowAuthModal(false);
      setAuthUsername('');
      setAuthPassword('');
      initWebSocket(data.token);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  return (
    <>
      {/* Header */}
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <Link href="/" className="brand">
            <span className="brand-badge">W2G</span>
          </Link>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {room ? room.name : 'Oda'}
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              👑 Oda Sahibi: <b style={{ color: 'var(--accent)' }}>{room ? room.creator : 'Yükleniyor...'}</b>
              {isHost && <span style={{ color: 'var(--warning)', marginLeft: '0.35rem' }}>(Sen)</span>}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={copyRoomLink} title="Oda linkini kopyala">
            📋 Paylaş
          </button>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                👤 <b>{user.username}</b>
              </span>
            </div>
          )}
        </div>
      </nav>

      {/* Main Room Grid */}
      <div className="room-layout">
        {/* Video & Controls Column */}
        <div className="room-main">
          {/* Video Input Bar */}
          <div className="card" style={{ marginBottom: 0, padding: '0.6rem 0.8rem' }}>
            {isHost ? (
              <form onSubmit={handleVideoChange} className="input-group">
                <input
                  type="text"
                  className="input"
                  placeholder="YouTube linki veya ID yapıştır (örn: https://youtu.be/...)"
                  style={{ fontSize: '0.88rem' }}
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                  ▶ Yükle
                </button>
              </form>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
                <span>🔒</span>
                <span>Video kontrolleri sadece oda sahibinde: <b style={{ color: 'var(--accent)' }}>{room ? room.creator : 'Oda Sahibi'}</b></span>
              </div>
            )}
          </div>

          {/* 16:9 Video Player Container */}
          <div className="video-wrapper" ref={videoContainerRef} style={{ position: 'relative' }}>
            <div id="yt-player-target"></div>
            {!isHost && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 20,
                  cursor: 'pointer',
                  background: 'rgba(0, 0, 0, 0.001)',
                }}
                onClick={() => {
                  if (playerRef.current) {
                    playerRef.current?.playVideo?.();
                  }
                  showNotification('Video odayla senkronize (Kontrol oda sahibinde 🔒)');
                }}
                title="Odayla senkronize izleniyor"
              />
            )}
          </div>

          {/* Player Sync Controls */}
          <div className="player-controls">
            {isHost ? (
              <div className="control-btn-group">
                <button className="btn btn-secondary btn-sm" onClick={togglePlayPause}>
                  ⏯ Oynat/Durdur
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => seekRelative(-10)} title="10s Geri">
                  ⏪ -10s
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => seekRelative(10)} title="10s İleri">
                  +10s ⏩
                </button>
                <button className="btn btn-accent btn-sm" onClick={forceSync} title="Herkesi eşitle">
                  ⚡ Eşitle
                </button>
              </div>
            ) : (
              <div className="control-btn-group">
                <span style={{ fontSize: '0.82rem', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.6rem', background: 'rgba(210,153,34,0.1)', borderRadius: '6px' }}>
                  🔒 Sadece oda sahibi ilerletebilir
                </span>
                <button className="btn btn-secondary btn-sm" onClick={forceSync} title="Odaya tekrar hizalan">
                  🔄 Eşitle
                </button>
              </div>
            )}

            <div className="sync-status">
              <span className={`status-dot ${syncStatus.playing ? '' : 'syncing'}`}></span>
              <span>{syncStatus.text}</span>
              {syncStatus.actor && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  · {syncStatus.actor}
                </span>
              )}
              {isHost && (
                <span style={{ fontSize: '0.72rem', color: 'var(--warning)', background: 'rgba(210,153,34,0.15)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                  👑 Sekmeyi alta alırsan video herkes için durur
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: Chat & Participants */}
        <div className="room-sidebar">
          <div className="sidebar-tabs">
            <button
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              💬 Sohbet
            </button>
            <button
              className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              👥 Kişiler ({users.length})
            </button>
          </div>

          {/* Chat Tab */}
          {activeTab === 'chat' && (
            <div className="chat-box">
              <div className="chat-messages">
                <div className="chat-msg" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Oda sohbeti başladı!
                </div>
                {messages.map((m, idx) => (
                  <div key={idx} className="chat-msg">
                    <span className="chat-msg-user">{m.username}: </span>
                    <span>{m.text}</span>
                    <span className="chat-msg-time">
                      {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>

              <form className="chat-input-bar" onSubmit={handleSendChat}>
                <input
                  type="text"
                  className="input"
                  placeholder="Mesaj yaz..."
                  maxLength={250}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Gönder
                </button>
              </form>
            </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="users-list">
              {users.map((u, idx) => {
                const isUserHost = room && u === room.creator;
                return (
                  <div key={idx} className="user-item" style={{ justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="status-dot"></span>
                      <span>{u}</span>
                      {isUserHost && <span style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>👑 Oda Sahibi</span>}
                    </div>
                    {user && user.username === u && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(Sen)</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal if unauthenticated */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem' }}>Odaya Katılmak İçin Giriş Yap</h3>
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
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  placeholder="Kullanıcı adı"
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
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
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
