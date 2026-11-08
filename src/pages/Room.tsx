import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Film,
  User,
  Lock,
  MessageCircle,
  Share2,
  Check,
  Copy,
  Sparkles,
  Radio
} from 'lucide-react';
import VideoPlayer from '../components/VideoPlayer';
import Chat from '../components/Chat';
import ShareModal from '../components/ShareModal';
import { database, isConfigured, authReady, auth, clientUserId } from '../firebase';
import { ref, get, set, onValue, serverTimestamp } from 'firebase/database';
import {
  saveRecentRoom,
  shareToWhatsApp,
  shareToInstagramOrNative
} from '../lib/roomStorage';
import './Room.css';

interface InitRoomData {
  isCreator?: boolean;
  controlMode?: 'anyone' | 'host';
  roomTitle?: string;
  pin?: string;
  preloadUrl?: string;
  preloadedDriveFile?: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    embedUrl?: string;
    token: string;
  };
}

function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

function extractDriveId(url: string): string | null {
  const match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return null;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const actualRoomId = roomId || 'UNKNOWN';

  const [nickname, setNickname] = useState<string>('');
  const [inputNickname, setInputNickname] = useState<string>('');
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(true);
  const [authed, setAuthed] = useState<boolean>(!isConfigured);
  const [roomTitle, setRoomTitle] = useState<string>('');
  const [roomPin, setRoomPin] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [isPinUnlocked, setIsPinUnlocked] = useState<boolean>(true);
  const [shareFeedback, setShareFeedback] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);

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
    window.scrollTo(0, 0);
    const savedName = localStorage.getItem('watchparty_nickname') || '';
    if (savedName) {
      setNickname(savedName);
      setShowNamePrompt(false);
    }
  }, []);

  // Wait for auth attempt (resolves even if Anonymous Auth is disabled in Console)
  useEffect(() => {
    let cancelled = false;
    authReady.finally(() => {
      if (!cancelled) setAuthed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize room in Firebase if it doesn't exist & apply preloaded video/settings
  useEffect(() => {
    if (!isConfigured || !database || !authed || showNamePrompt || !roomId) return;

    const initRaw = sessionStorage.getItem(`watchparty_init_${roomId}`);
    let initData: InitRoomData = {};
    if (initRaw) {
      try {
        initData = JSON.parse(initRaw);
      } catch {
        // ignore parse errors
      }
      sessionStorage.removeItem(`watchparty_init_${roomId}`);
    }

    const currentUid = auth?.currentUser?.uid || clientUserId;
    const createdAtRef = ref(database, `rooms/${roomId}/createdAt`);

    const applyPreloadedVideo = async () => {
      if (!database) return;
      const now = Date.now();
      if (initData.preloadedDriveFile) {
        const f = initData.preloadedDriveFile;
        if (f.token) updateGoogleToken(f.token);
        await set(ref(database, `rooms/${roomId}/video`), {
          source: 'drive-oauth',
          driveFileId: f.id,
          name: f.name,
          mimeType: f.mimeType,
          ...(f.sizeBytes ? { size: f.sizeBytes } : {}),
          ...(f.token ? { accessToken: f.token } : {}),
          previewUrl: f.embedUrl || `https://drive.google.com/file/d/${f.id}/preview`,
          updatedAt: now,
          updatedBy: currentUid
        });
      } else if (initData.preloadUrl) {
        const url = initData.preloadUrl;
        const ytId = extractYouTubeId(url);
        const driveId = extractDriveId(url);
        if (ytId) {
          await set(ref(database, `rooms/${roomId}/video`), {
            source: 'youtube',
            youtubeId: ytId,
            directUrl: url,
            name: `YouTube (${ytId})`,
            updatedAt: now,
            updatedBy: currentUid
          });
        } else if (driveId) {
          await set(ref(database, `rooms/${roomId}/video`), {
            source: 'drive-oauth',
            driveFileId: driveId,
            name: 'Vídeo do Google Drive',
            ...(googleToken ? { accessToken: googleToken } : {}),
            previewUrl: `https://drive.google.com/file/d/${driveId}/preview`,
            updatedAt: now,
            updatedBy: currentUid
          });
        } else {
          await set(ref(database, `rooms/${roomId}/video`), {
            source: 'manual',
            directUrl: url,
            name: 'Vídeo da Web',
            updatedAt: now,
            updatedBy: currentUid
          });
        }
      }

      if (initData.preloadedDriveFile || initData.preloadUrl) {
        await set(ref(database, `rooms/${roomId}/playback`), {
          status: 'paused',
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          updatedAt: now,
          updatedBy: currentUid,
          updatedByName: nickname || 'Host',
          action: 'pause',
          seq: 1
        });
      }
    };

    get(createdAtRef)
      .then(async (snapshot) => {
        const settingsPayload: Record<string, string> = {
          controlMode: initData.controlMode || 'anyone'
        };
        if (initData.roomTitle) settingsPayload.roomTitle = initData.roomTitle;
        if (initData.pin) settingsPayload.pin = initData.pin;

        const isRoomCreator =
          Boolean(initData.isCreator) ||
          localStorage.getItem(`watchparty_creator_${roomId}`) === 'true';

        if (!snapshot.exists()) {
          try {
            localStorage.setItem(`watchparty_creator_${roomId}`, 'true');
            await set(createdAtRef, serverTimestamp());
            if (currentUid) {
              await set(ref(database, `rooms/${roomId}/hostId`), currentUid);
            }
            await set(ref(database, `rooms/${roomId}/settings`), settingsPayload);
            await applyPreloadedVideo();
          } catch (err) {
            console.error('Erro ao inicializar a sala no Firebase:', err);
          }
        } else if (isRoomCreator && currentUid) {
          localStorage.setItem(`watchparty_creator_${roomId}`, 'true');
          await set(ref(database, `rooms/${roomId}/hostId`), currentUid).catch(() => {});
          if (initData.isCreator) {
            await set(ref(database, `rooms/${roomId}/settings`), settingsPayload).catch(() => {});
            await applyPreloadedVideo().catch(() => {});
          }
        }
      })
      .catch((err) => {
        console.error('Erro ao verificar existência da sala no Firebase:', err);
      });
  }, [roomId, showNamePrompt, authed, googleToken, nickname]);

  // Listen to room settings (title, PIN) and save to Recent Rooms
  useEffect(() => {
    if (!roomId || showNamePrompt) return;

    if (!isConfigured || !database) {
      saveRecentRoom({
        roomId,
        lastVisitedAt: Date.now()
      });
      return;
    }

    const settingsRef = ref(database, `rooms/${roomId}/settings`);
    const unsub = onValue(settingsRef, (snap) => {
      const val = snap.val();
      const title = val?.roomTitle || '';
      const pin = val?.pin || '';
      setRoomTitle(title);
      setRoomPin(pin);

      if (pin) {
        const unlockedPin = sessionStorage.getItem(`watchparty_unlocked_${roomId}`);
        setIsPinUnlocked(unlockedPin === pin);
      } else {
        setIsPinUnlocked(true);
      }

      saveRecentRoom({
        roomId,
        roomTitle: title || undefined,
        lastVisitedAt: Date.now(),
        hasPin: Boolean(pin)
      });
    });

    return () => unsub();
  }, [roomId, showNamePrompt]);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;

    const name = inputNickname.trim();
    localStorage.setItem('watchparty_nickname', name);
    setNickname(name);
    setShowNamePrompt(false);
  };

  const handleUnlockPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === roomPin) {
      sessionStorage.setItem(`watchparty_unlocked_${actualRoomId}`, roomPin);
      setIsPinUnlocked(true);
      setPinError('');
    } else {
      setPinError('Senha incorreta! Peça a senha ao anfitrião da sala.');
    }
  };

  const handleQuickInsta = async () => {
    const res = await shareToInstagramOrNative(actualRoomId, roomTitle, roomPin);
    if (res === 'copied') {
      setShareFeedback('Convite copiado! Cole no Direct do Insta 📸');
      setTimeout(() => setShareFeedback(''), 3500);
    }
  };

  const handleCopyInvite = () => {
    const inviteLink = `${window.location.origin}/room/${actualRoomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  // 1. Nickname prompt if user doesn't have one (e.g. joined via shared link)
  if (showNamePrompt) {
    return (
      <div className="room-prompt-container animate-fade-in">
        <div className="ambient-mesh-canvas" aria-hidden="true">
          <div className="ambient-violet-spot" />
          <div className="ambient-amber-spot" />
          <div className="ambient-grid-overlay" />
        </div>

        <div className="studio-prompt-card">
          <div className="prompt-card-top-kicker">
            <Sparkles size={12} className="kicker-glyph" />
            <span>DUOCINE CINEMA STUDIO</span>
          </div>

          <div className="prompt-title-header">
            <h2>Entrar na Sessão</h2>
            <div className="prompt-room-badge">
              <span className="room-beacon-dot" />
              <span>
                SALA: <strong>{actualRoomId}</strong>
              </span>
              {roomTitle && <span className="room-title-extra">• "{roomTitle}"</span>}
            </div>
            <p className="prompt-desc">
              Escolha seu apelido para sincronizar play/pause, chat e pipoca em tempo real.
            </p>
          </div>

          <form onSubmit={handleJoinSubmit} className="prompt-studio-form">
            <div className="input-field-unit">
              <div className="field-label-wrap">
                <label htmlFor="prompt-nickname">Seu Apelido na Party</label>
                <span className="field-tag required">Obrigatório</span>
              </div>
              <input
                id="prompt-nickname"
                type="text"
                className="studio-input-box"
                placeholder="Ex: Amor, Convidado VIP, Pipoca..."
                value={inputNickname}
                onChange={(e) => setInputNickname(e.target.value)}
                maxLength={20}
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn-action-primary">
              <span className="button-sweep-shimmer" aria-hidden="true" />
              <span className="btn-main-label">Entrar na Sala de Cinema</span>
              <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </form>

          <Link to="/" className="prompt-back-home-link">
            <ArrowLeft size={14} /> Voltar para a Tela Inicial
          </Link>
        </div>
      </div>
    );
  }

  // 2. Wait for the session initialization before attaching any database listener
  if (!authed) {
    return (
      <div className="room-prompt-container animate-fade-in">
        <div className="studio-prompt-card">
          <p className="prompt-desc">Conectando ao Sync Engine da sala...</p>
        </div>
      </div>
    );
  }

  // 3. Room Password / PIN Prompt if room is private
  if (roomPin && !isPinUnlocked) {
    return (
      <div className="room-prompt-container animate-fade-in">
        <div className="ambient-mesh-canvas" aria-hidden="true">
          <div className="ambient-violet-spot" />
          <div className="ambient-amber-spot" />
          <div className="ambient-grid-overlay" />
        </div>

        <div className="studio-prompt-card lock-mode">
          <div className="prompt-card-top-kicker lock">
            <Lock size={12} className="kicker-glyph" />
            <span>SALA PROTEGIDA POR SENHA</span>
          </div>

          <div className="prompt-title-header">
            <h2>Sessão Privada</h2>
            <div className="prompt-room-badge">
              <span className="room-beacon-dot lock" />
              <span>
                SALA: <strong>{actualRoomId}</strong>
              </span>
              {roomTitle && <span className="room-title-extra">• "{roomTitle}"</span>}
            </div>
            <p className="prompt-desc">
              Esta sessão é privada. Digite o PIN fornecido pelo anfitrião para liberar a exibição.
            </p>
          </div>

          <form onSubmit={handleUnlockPin} className="prompt-studio-form">
            <div className="input-field-unit">
              <div className="field-label-wrap">
                <label htmlFor="prompt-pin">Senha / PIN da Party</label>
                <span className="field-tag lock">Segurança</span>
              </div>
              <input
                id="prompt-pin"
                type="password"
                className="studio-input-box mono-code"
                placeholder="Digite a senha..."
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                required
                autoFocus
              />
              {pinError && <p className="pin-error-notice">{pinError}</p>}
            </div>

            <button type="submit" className="btn-action-primary">
              <span className="button-sweep-shimmer" aria-hidden="true" />
              <span className="btn-main-label">Desbloquear e Assistir</span>
              <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </form>

          <Link to="/" className="prompt-back-home-link">
            <ArrowLeft size={14} /> Voltar para a Tela Inicial
          </Link>
        </div>
      </div>
    );
  }

  // 4. Full Room View
  return (
    <div className="room-page-layout">
      {shareFeedback && <div className="room-share-toast glass">{shareFeedback}</div>}

      {/* Navigation Header */}
      <header className="room-navbar studio-header">
        <div className="nav-left">
          <Link to="/" className="btn-back-home" title="Voltar para a página inicial">
            <ArrowLeft size={17} />
          </Link>
          <div className="nav-brand-cluster">
            <div className="nav-logo-icon">
              <Film size={17} />
            </div>
            <div className="nav-title-group">
              <span className="nav-brand-name">DuoCine</span>
              <span className="nav-session-title" title={roomTitle || 'Sessão Cinema'}>
                {roomTitle || 'Sessão Cinema'}
              </span>
            </div>
          </div>
          <span className="nav-room-badge" title="Código único da sala">
            {roomPin ? (
              <Lock size={11} className="badge-lock-icon" />
            ) : (
              <Radio size={11} className="badge-live-icon" />
            )}
            <span>{actualRoomId}</span>
          </span>
        </div>

        <div className="nav-right">
          {/* Quick Share Actions: Unified Compartilhar, WhatsApp, Instagram, Link */}
          <div className="nav-share-group">
            {/* Primary Unified Share Trigger */}
            <button
              type="button"
              onClick={() => setIsShareModalOpen(true)}
              className="btn-nav-share share-main"
              title="Abrir opções de compartilhamento (WhatsApp, Instagram, Link)"
            >
              <Share2 size={14} />
              <span>Compartilhar</span>
            </button>

            {/* Quick 1-click WhatsApp */}
            <button
              type="button"
              onClick={() => shareToWhatsApp(actualRoomId, roomTitle, roomPin)}
              className="btn-nav-share whatsapp hide-mobile"
              title="Enviar convite no WhatsApp (escolher contato)"
            >
              <MessageCircle size={14} />
              <span>WhatsApp</span>
            </button>

            {/* Quick 1-click Instagram */}
            <button
              type="button"
              onClick={handleQuickInsta}
              className="btn-nav-share instagram hide-mobile"
              title="Copiar convite e abrir Instagram Direct"
            >
              <Share2 size={14} />
              <span>Instagram</span>
            </button>

            {/* Quick Copy Link */}
            <button
              type="button"
              onClick={handleCopyInvite}
              className={`btn-nav-share copy ${copiedLink ? 'copied' : ''}`}
              title="Copiar link direto da sala"
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              <span className="hide-mobile">{copiedLink ? 'Copiado!' : 'Link'}</span>
            </button>
          </div>

          <div className="user-badge" title={`Você está logado como: ${nickname}`}>
            <User size={13} />
            <span className="user-badge-name">{nickname}</span>
          </div>

          {!isConfigured && <span className="demo-badge">DEMO</span>}
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
          <Chat
            roomId={actualRoomId}
            nickname={nickname}
            roomTitle={roomTitle}
            roomPin={roomPin}
          />
        </div>
      </main>

      {/* Studio Share Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        roomId={actualRoomId}
        roomTitle={roomTitle}
        pin={roomPin}
      />
    </div>
  );
}
