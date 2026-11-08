import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Film,
  Users,
  ArrowRight,
  Shield,
  Lock,
  FolderOpen,
  Clock,
  Share2,
  MessageCircle,
  Trash2,
  X,
  Link2,
  Subtitles,
  Sparkles,
  Play,
  CheckCircle2,
  Tv,
  Zap,
  Radio,
  Sliders,
  Volume2
} from 'lucide-react';
import { isConfigured } from '../firebase';
import { loadGoogleApis, requestDriveToken, openDrivePicker } from '../lib/googleDrive';
import {
  getRecentRooms,
  removeRecentRoom,
  shareToWhatsApp,
  shareToInstagramOrNative,
  type RecentRoomItem
} from '../lib/roomStorage';
import ShareModal from '../components/ShareModal';
import './Home.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
const GOOGLE_APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || '';

interface PreloadedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  embedUrl?: string;
  token: string;
}

interface CinemaParticle {
  id: number;
  emoji: string;
  left: number;
}

const CINEMA_EMOJIS = ['❤️', '😂', '🔥', '🍿', '😱', '👏'];

export default function Home() {
  const navigate = useNavigate();

  // Inputs
  const [nickname, setNickname] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [roomPin, setRoomPin] = useState('');
  const [controlMode, setControlMode] = useState<'anyone' | 'host'>('anyone');
  const [preloadUrl, setPreloadUrl] = useState('');
  const [preloadedDriveFile, setPreloadedDriveFile] = useState<PreloadedDriveFile | null>(null);

  // Join Room
  const [roomIdInput, setRoomIdInput] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentRoomItem[]>([]);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [shareModalItem, setShareModalItem] = useState<{
    roomId: string;
    roomTitle?: string;
    pin?: string;
  } | null>(null);

  // Interactive Cinema Engine Deck State
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(44);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [particles, setParticles] = useState<CinemaParticle[]>([]);
  const particleSeq = useRef(1);

  useEffect(() => {
    const savedName = localStorage.getItem('watchparty_nickname') || '';
    setNickname(savedName);
    setRecentRooms(getRecentRooms());
  }, []);

  // Simulator playback progress
  useEffect(() => {
    if (!isPlaying || countdown !== null) return;
    const t = window.setInterval(() => {
      setProgress((prev) => (prev >= 98 ? 10 : +(prev + 0.35).toFixed(2)));
    }, 280);
    return () => window.clearInterval(t);
  }, [isPlaying, countdown]);

  const handleMouseMoveSpotlight = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  const triggerReaction = (emoji: string) => {
    const id = particleSeq.current++;
    const left = 14 + Math.floor(Math.random() * 72);
    setParticles((prev) => [...prev.slice(-14), { id, emoji, left }]);
    window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 2000);
  };

  const triggerCountdown = () => {
    if (countdown !== null) return;
    setIsPlaying(false);
    setCountdown(3);
    window.setTimeout(() => setCountdown(2), 700);
    window.setTimeout(() => setCountdown(1), 1400);
    window.setTimeout(() => {
      setCountdown(null);
      setIsPlaying(true);
      triggerReaction('🍿');
    }, 2100);
  };

  const handlePreselectDrive = async () => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY || !GOOGLE_APP_ID) {
      alert('Integração do Google Drive não configurada.');
      return;
    }
    try {
      await loadGoogleApis();
      let token = sessionStorage.getItem('watchparty_google_token') || '';
      if (!token) {
        token = await requestDriveToken(GOOGLE_CLIENT_ID);
        sessionStorage.setItem('watchparty_google_token', token);
      }

      openDrivePicker({
        apiKey: GOOGLE_API_KEY,
        appId: GOOGLE_APP_ID,
        token,
        onSelect: (file) => {
          setPreloadedDriveFile({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            embedUrl: file.embedUrl,
            token
          });
          setPreloadUrl('');
        }
      });
    } catch (err) {
      console.error('Erro ao pré-selecionar vídeo do Google Drive:', err);
    }
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    localStorage.setItem('watchparty_nickname', nickname.trim());

    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const generatedRoomId = `PARTY-${randomId}`;

    sessionStorage.setItem(
      `watchparty_init_${generatedRoomId}`,
      JSON.stringify({
        isCreator: true,
        controlMode,
        roomTitle: roomTitle.trim() || undefined,
        pin: roomPin.trim() || undefined,
        preloadUrl: preloadUrl.trim() || undefined,
        preloadedDriveFile: preloadedDriveFile || undefined
      })
    );

    if (roomPin.trim()) {
      sessionStorage.setItem(`watchparty_unlocked_${generatedRoomId}`, roomPin.trim());
    }

    navigate(`/room/${generatedRoomId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !roomIdInput.trim()) return;

    localStorage.setItem('watchparty_nickname', nickname.trim());
    const cleanRoomId = roomIdInput.trim().toUpperCase();
    navigate(`/room/${cleanRoomId}`);
  };

  const handleRemoveRecent = (id: string) => {
    setRecentRooms(removeRecentRoom(id));
  };

  const handleQuickInstaShare = async (room: RecentRoomItem) => {
    const res = await shareToInstagramOrNative(room.roomId, room.roomTitle);
    if (res === 'copied') {
      setShareToast(`Convite da sala ${room.roomId} copiado! Cole no Direct do Instagram.`);
      setTimeout(() => setShareToast(null), 4000);
    }
  };

  return (
    <div className="home-root">
      {/* Ambient Lighting & Micro Mesh */}
      <div className="ambient-mesh-canvas" aria-hidden="true">
        <div className="ambient-violet-spot" />
        <div className="ambient-amber-spot" />
        <div className="ambient-grid-overlay" />
      </div>

      {shareToast && <div className="home-share-toast">{shareToast}</div>}

      {/* Top Header */}
      <header className="home-header-nav">
        <div className="brand-group">
          <div className="brand-icon-box">
            <Film size={16} />
          </div>
          <span className="brand-text-name">DuoCine</span>
          <span className="brand-text-sep">•</span>
          <span className="brand-text-desc">Watch2Gether Studio</span>
        </div>

        <div className="header-status-pill">
          <span className="beacon-dot" />
          <span>Sync Engine Ativo</span>
        </div>
      </header>

      {/* Main Studio Canvas */}
      <main className="home-studio-canvas">
        {/* Punchy, Non-bloated Editorial Hero */}
        <section className="compact-hero">
          <div className="hero-pill-badge">
            <Radio size={12} className="badge-pulse-icon" />
            <span>SESSÃO PRIVADA DE CINEMA</span>
          </div>

          <h1 className="hero-punchy-title">
            Cinema compartilhado, <span className="gradient-text">em sincronia absoluta.</span>
          </h1>

          <p className="hero-punchy-subtitle">
            Assista a vídeos do Google Drive, YouTube ou Web com quem você ama. Play, pause e legendas
            sincronizados em tempo real no PC e Celular.
          </p>

          {!isConfigured && (
            <div className="demo-notice-banner">
              Modo demonstração local ativo (configure o <code>.env.local</code> para sincronização em nuvem).
            </div>
          )}
        </section>

        {/* PRIMARY ACTION SECTION: Criar Sala & Entrar com Código */}
        <section className="studio-actions-grid">
          {/* CARD 1: CRIAR NOVA SALA */}
          <div
            className="action-studio-card create-card"
            onMouseMove={handleMouseMoveSpotlight}
          >
            <div className="card-header-bar">
              <div className="card-title-cluster">
                <span className="card-category-tag">NOVA SESSÃO</span>
                <h2>Criar Sala</h2>
              </div>
              <span className="badge-instant">Início Rápido</span>
            </div>

            <form onSubmit={handleCreateRoom} className="card-form-grid">
              {/* Row 1: SEU APELIDO & NOME DA SESSÃO lado a lado */}
              <div className="form-split-row">
                <div className="input-field-unit">
                  <div className="field-label-wrap">
                    <label htmlFor="create-nickname">Seu Apelido</label>
                    <span className="field-tag required">Obrigatório</span>
                  </div>
                  <input
                    id="create-nickname"
                    type="text"
                    className="studio-input-box"
                    placeholder="Ex: Phillip / Amor"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={20}
                    required
                  />
                </div>

                <div className="input-field-unit">
                  <div className="field-label-wrap">
                    <label htmlFor="create-room-title">
                      <Sparkles size={12} className="label-icon-purple" />
                      Nome da Sessão
                    </label>
                    <span className="field-tag optional">Opcional</span>
                  </div>
                  <input
                    id="create-room-title"
                    type="text"
                    className="studio-input-box"
                    placeholder="Ex: Cine de Sábado 🍿"
                    value={roomTitle}
                    onChange={(e) => setRoomTitle(e.target.value)}
                    maxLength={40}
                  />
                </div>
              </div>

              {/* Row 2: SENHA / PIN DA SALA (Em cima do controle de reprodução) */}
              <div className="input-field-unit">
                <div className="field-label-wrap">
                  <label htmlFor="create-pin">
                    <Lock size={12} className="label-icon-amber" />
                    Senha / PIN da Sala
                  </label>
                  <span className="field-tag optional">Opcional</span>
                </div>
                <input
                  id="create-pin"
                  type="text"
                  className="studio-input-box"
                  placeholder="Deixe vazio para sala aberta ou defina um PIN (ex: 1234)"
                  value={roomPin}
                  onChange={(e) => setRoomPin(e.target.value)}
                  maxLength={16}
                />
              </div>

              {/* Row 3: CONTROLE DE REPRODUÇÃO (Embaixo da senha) */}
              <div className="input-field-unit">
                <div className="field-label-wrap">
                  <label>Controle de Reprodução (Play / Pause)</label>
                </div>
                <div className="segmented-switch" data-mode={controlMode}>
                  <div className="switch-active-pill" aria-hidden="true" />
                  <button
                    type="button"
                    className={`switch-tab-btn ${controlMode === 'anyone' ? 'active' : ''}`}
                    onClick={() => setControlMode('anyone')}
                  >
                    <Users size={14} />
                    <span>Controle Livre (Todos)</span>
                  </button>
                  <button
                    type="button"
                    className={`switch-tab-btn ${controlMode === 'host' ? 'active' : ''}`}
                    onClick={() => setControlMode('host')}
                  >
                    <Shield size={14} />
                    <span>Apenas o Host</span>
                  </button>
                </div>
              </div>

              {/* Row 4: FILME INICIAL DA SALA */}
              <div className="media-preset-card">
                <div className="field-label-wrap">
                  <label>
                    <Film size={12} className="label-icon-emerald" />
                    Já Deixar Filme Pronto
                  </label>
                  <span className="field-tag optional">Opcional</span>
                </div>

                {preloadedDriveFile ? (
                  <div className="drive-file-selected-box">
                    <CheckCircle2 size={16} className="file-check-icon" />
                    <span className="file-name-text" title={preloadedDriveFile.name}>
                      {preloadedDriveFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreloadedDriveFile(null)}
                      className="btn-clear-file"
                      title="Remover vídeo selecionado"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="media-actions-row">
                    <button
                      type="button"
                      onClick={handlePreselectDrive}
                      className="btn-pick-drive"
                    >
                      <FolderOpen size={15} />
                      <span>Escolher do Google Drive</span>
                    </button>

                    <div className="url-input-container">
                      <Link2 size={13} className="url-glyph" />
                      <input
                        type="text"
                        className="studio-input-box url-field"
                        placeholder="Ou cole link do YouTube, Drive ou .mp4..."
                        value={preloadUrl}
                        onChange={(e) => setPreloadUrl(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Main Action Submit */}
              <button type="submit" className="btn-action-primary">
                <span className="button-sweep-shimmer" aria-hidden="true" />
                <span className="btn-main-label">Criar Sala de Cinema</span>
                <ArrowRight size={17} className="btn-forward-arrow" />
              </button>
            </form>
          </div>

          {/* CARD 2: ENTRAR EM SALA EXISTENTE */}
          <div
            className="action-studio-card join-card"
            onMouseMove={handleMouseMoveSpotlight}
          >
            <div className="card-header-bar">
              <div className="card-title-cluster">
                <span className="card-category-tag">PARTY EXISTENTE</span>
                <h2>Entrar com Código</h2>
              </div>
              <span className="badge-instant">Link ou Código</span>
            </div>

            <form onSubmit={handleJoinRoom} className="card-form-grid">
              <div className="input-field-unit">
                <div className="field-label-wrap">
                  <label htmlFor="join-room-id">Código da Sala</label>
                  <span className="field-tag required">Obrigatório</span>
                </div>
                <input
                  id="join-room-id"
                  type="text"
                  className="studio-input-box mono-code"
                  placeholder="Ex: PARTY-A1B2C3"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="input-field-unit">
                <div className="field-label-wrap">
                  <label htmlFor="join-nickname">Seu Apelido</label>
                  <span className="field-tag required">Obrigatório</span>
                </div>
                <input
                  id="join-nickname"
                  type="text"
                  className="studio-input-box"
                  placeholder="Como você quer aparecer no chat?"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-action-secondary"
                disabled={!roomIdInput.trim() || !nickname.trim()}
              >
                <span>Entrar na Sala</span>
                <ArrowRight size={17} className="btn-forward-arrow" />
              </button>
            </form>

            {/* Recent Rooms Module */}
            {recentRooms.length > 0 && (
              <div className="recent-rooms-container">
                <div className="recent-head-line">
                  <Clock size={12} />
                  <span>Salas Recentes (Acesso em 1 clique)</span>
                </div>

                <div className="recent-items-stack">
                  {recentRooms.slice(0, 3).map((item) => (
                    <div key={item.roomId} className="recent-ticket-row">
                      <button
                        type="button"
                        className="recent-ticket-btn"
                        onClick={() => navigate(`/room/${item.roomId}`)}
                      >
                        <span className="ticket-beacon-dot" />
                        <div className="ticket-text-block">
                          <span className="ticket-room-name">
                            {item.roomTitle || item.roomId}
                          </span>
                          <span className="ticket-room-date">
                            {item.roomTitle ? `${item.roomId} • ` : ''}
                            {new Date(item.lastVisitedAt).toLocaleDateString([], {
                              day: '2-digit',
                              month: '2-digit'
                            })}
                          </span>
                        </div>
                      </button>

                      <div className="recent-ticket-shares">
                        <button
                          type="button"
                          onClick={() => shareToWhatsApp(item.roomId, item.roomTitle)}
                          className="btn-ticket-pill whatsapp"
                          title="Enviar convite no WhatsApp (escolher contato)"
                        >
                          <MessageCircle size={12} />
                          <span>WhatsApp</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickInstaShare(item)}
                          className="btn-ticket-pill instagram"
                          title="Copiar convite para enviar no Instagram Direct"
                        >
                          <Share2 size={12} />
                          <span>Instagram</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setShareModalItem({
                              roomId: item.roomId,
                              roomTitle: item.roomTitle,
                              pin: item.hasPin ? '••••' : undefined
                            })
                          }
                          className="btn-ticket-pill share-more"
                          title="Mais opções de compartilhamento e prévia"
                        >
                          <Share2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveRecent(item.roomId)}
                          className="btn-ticket-del"
                          title="Remover do histórico"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ==========================================================================
            CREATIVE SECTION 2: LIVE CINEMA ENGINE SHOWCASE
            High-craft studio monitor display (NOT a forced form card!)
            ========================================================================== */}
        <section className="live-engine-showcase-section">
          <div className="showcase-ambient-halo" aria-hidden="true" />

          {/* Studio Monitor Outer Frame */}
          <div className="cinema-monitor-frame" onMouseMove={handleMouseMoveSpotlight}>
            {/* Monitor Top Console Bar */}
            <div className="monitor-top-console">
              <div className="console-left">
                <div className="console-status-led">
                  <span className="led-core" />
                  <span className="led-label">CABINE DE TRANSMISSÃO SINCRONIZADA</span>
                </div>
                <span className="console-delay-tag">
                  <Zap size={11} /> Δ 14ms Latência
                </span>
              </div>

              <div className="console-right">
                <div className="console-sync-peers">
                  <span className="peer-pill host">
                    <span className="peer-dot" /> {nickname.trim() || 'Você (Host)'}
                  </span>
                  <span className="peer-link-symbol">⇄</span>
                  <span className="peer-pill guest">
                    <span className="peer-dot" /> Convidado
                  </span>
                </div>
              </div>
            </div>

            {/* Widescreen Theater Stage Display */}
            <div className="monitor-screen-viewport">
              {/* Floating Emojis Layer inside viewport */}
              <div className="viewport-particles-layer" aria-hidden="true">
                {particles.map((p) => (
                  <span
                    key={p.id}
                    className="cinema-stage-emoji"
                    style={{ left: `${p.left}%` }}
                  >
                    {p.emoji}
                  </span>
                ))}
              </div>

              {/* Countdown overlay */}
              {countdown !== null && (
                <div className="screen-countdown-dimmer">
                  <span className="countdown-pop-number">{countdown}</span>
                </div>
              )}

              {/* Center Movie Scene Simulation */}
              <div className="screen-center-stage">
                {!isPlaying && countdown === null && (
                  <div className="stage-paused-alert">
                    ⏸ Pausado por {nickname.trim() || 'Você'} • Toque em Play
                  </div>
                )}

                {subtitlesEnabled && (
                  <div className="stage-subtitles-bar">
                    “Quando você aperta play ou pausa aqui, começa na mesma fração de segundo em todos os aparelhos.”
                  </div>
                )}
              </div>

              {/* Cinema Player HUD on Stage */}
              <div className="screen-cinema-hud">
                <div className="hud-timestamps-row">
                  <span className="hud-time-active">00:46:18 / 01:38:40</span>
                  <span className="hud-remaining-badge">Faltam -00:52:22</span>
                </div>

                <div
                  className="hud-timeline-track"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100));
                    setProgress(Math.round(pct));
                  }}
                  title="Clique na linha do tempo para avançar o filme"
                >
                  <div className="hud-timeline-fill" style={{ width: `${progress}%` }} />
                </div>

                <div className="hud-control-strip">
                  <div className="hud-left-controls">
                    <button
                      type="button"
                      className="hud-play-toggle-btn"
                      onClick={() => setIsPlaying((p) => !p)}
                      title={isPlaying ? 'Pausar simulador' : 'Dar play no simulador'}
                    >
                      {isPlaying ? <span className="hud-pause-glyph" /> : <Play size={13} />}
                    </button>
                    <span className="hud-interactive-hint">
                      Clique no Play/Pause ou na barra para simular o controle
                    </span>
                  </div>

                  <div className="hud-right-features">
                    <button
                      type="button"
                      className={`hud-feature-btn ${subtitlesEnabled ? 'active' : ''}`}
                      onClick={() => setSubtitlesEnabled((s) => !s)}
                      title="Alternar legendas .SRT na tela"
                    >
                      <Subtitles size={13} />
                      <span>Legendas .SRT: {subtitlesEnabled ? 'Visíveis' : 'Ocultas'}</span>
                    </button>

                    <button
                      type="button"
                      className="hud-feature-btn countdown"
                      onClick={triggerCountdown}
                      title="Simular contagem regressiva 3, 2, 1 Play!"
                    >
                      <Sparkles size={13} />
                      <span>Testar 3, 2, 1 Play!</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Monitor Bottom Console Reaction Bar */}
            <div className="monitor-reaction-console">
              <div className="console-prompt">
                <Tv size={14} className="console-prompt-icon" />
                <span>Reações ao vivo na tela:</span>
              </div>

              <div className="console-emojis-row">
                {CINEMA_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="console-emoji-btn"
                    onClick={() => triggerReaction(emoji)}
                    title={`Disparar reação ${emoji} na tela`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="console-highlights">
                <span className="console-feat-pill">
                  <Volume2 size={12} /> Som Individual
                </span>
                <span className="console-feat-pill">
                  <Sliders size={12} /> Filtros de Imagem
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Clean Studio Footer */}
      <footer className="home-studio-footer">
        <div className="footer-meta-left">
          <span>DuoCine Watch2Gether</span>
          <span className="footer-bullet">•</span>
          <span>Google Drive, YouTube, Web & Legendas .SRT</span>
        </div>
        <div className="footer-meta-right">
          <span>Zero delay entre PC e Celular</span>
        </div>
      </footer>

      {shareModalItem && (
        <ShareModal
          isOpen={Boolean(shareModalItem)}
          onClose={() => setShareModalItem(null)}
          roomId={shareModalItem.roomId}
          roomTitle={shareModalItem.roomTitle}
          pin={shareModalItem.pin}
        />
      )}
    </div>
  );
}
