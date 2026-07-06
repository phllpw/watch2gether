import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Film, User } from 'lucide-react';
import VideoPlayer from '../components/VideoPlayer';
import Chat from '../components/Chat';
import { database, isConfigured } from '../firebase';
import { ref, get, set, serverTimestamp } from 'firebase/database';
import './Room.css';

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const [nickname, setNickname] = useState<string>('');
  const [inputNickname, setInputNickname] = useState<string>('');
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(true);
  const [googleToken, setGoogleToken] = useState<string>(() => {
    return sessionStorage.getItem('watchparty_google_token') || '';
  });

  const updateGoogleToken = (token: string) => {
    setGoogleToken(token);
    if (token) {
      sessionStorage.setItem('watchparty_google_token', token);
    } else {
      sessionStorage.removeItem('watchparty_google_token');
    }
  };

  useEffect(() => {
    const savedName = localStorage.getItem('watchparty_nickname') || '';
    if (savedName) {
      setNickname(savedName);
      setShowNamePrompt(false);
    }
  }, []);

  // Initialize room in Firebase if it doesn't exist
  useEffect(() => {
    if (!isConfigured || !database || showNamePrompt || !roomId) return;

    const roomRef = ref(database, `rooms/${roomId}`);
    get(roomRef).then((snapshot) => {
      if (!snapshot.exists()) {
        set(roomRef, {
          createdAt: serverTimestamp(),
          videoUrl: '',
          playback: {
            playing: false,
            currentTime: 0,
            lastUpdated: serverTimestamp(),
            updatedBy: 'Sistema'
          }
        }).then(() => {
          console.log(`Sala ${roomId} inicializada com sucesso no Firebase.`);
        }).catch((err) => {
          console.error("Erro ao inicializar a sala no Firebase:", err);
        });
      }
    }).catch((err) => {
      console.error("Erro ao verificar existência da sala no Firebase:", err);
    });
  }, [roomId, showNamePrompt]);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;

    const name = inputNickname.trim();
    localStorage.setItem('watchparty_nickname', name);
    setNickname(name);
    setShowNamePrompt(false);
  };

  const actualRoomId = roomId || 'UNKNOWN';

  // 1. Nickname prompt if user doesn't have one (e.g. joined via shared link)
  if (showNamePrompt) {
    return (
      <div className="room-prompt-container animate-fade-in">
        <div className="room-prompt-card glass">
          <div className="logo-badge">
            <Film size={18} className="logo-icon" />
            <span>Watch2Gether</span>
          </div>
          
          <h2>Entrar na Sala</h2>
          <p className="prompt-desc">
            Você foi convidado para a sala <strong className="room-id-highlight">{actualRoomId}</strong>. 
            Escolha um apelido para entrar no chat e acompanhar o vídeo.
          </p>

          <form onSubmit={handleJoinSubmit} className="prompt-form">
            <div className="form-group">
              <label htmlFor="prompt-nickname">Seu Apelido</label>
              <input
                id="prompt-nickname"
                type="text"
                className="input-field"
                placeholder="Ex: Convidado"
                value={inputNickname}
                onChange={(e) => setInputNickname(e.target.value)}
                maxLength={20}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Entrar na Sala
            </button>
          </form>

          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> Voltar para a Tela Inicial
          </Link>
        </div>
      </div>
    );
  }

  // 2. Full Room View
  return (
    <div className="room-page-layout">
      {/* Navigation Header */}
      <header className="room-navbar glass">
        <div className="nav-left">
          <Link to="/" className="btn-back-home" title="Voltar para Home">
            <ArrowLeft size={18} />
          </Link>
          <div className="nav-logo">
            <Film size={20} className="brand-color-icon" />
            <span className="logo-text">Watch2Gether</span>
          </div>
          <span className="nav-room-badge">Sala: {actualRoomId}</span>
        </div>

        <div className="nav-right">
          <div className="user-badge">
            <User size={14} />
            <span>{nickname}</span>
          </div>
          {!isConfigured && (
            <span className="demo-badge">DEMO</span>
          )}
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="room-workspace">
        <div className="video-area">
          <VideoPlayer 
            roomId={actualRoomId} 
            nickname={nickname} 
            googleToken={googleToken}
            setGoogleToken={updateGoogleToken}
          />
        </div>
        <div className="chat-area">
          <Chat roomId={actualRoomId} nickname={nickname} />
        </div>
      </main>
    </div>
  );
}
