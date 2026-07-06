import React, { useState, useEffect, useRef } from 'react';
import { Play, Link2, AlertCircle, Info } from 'lucide-react';
import { database, isConfigured } from '../firebase';
import { ref, onValue, set } from 'firebase/database';
import { loadGoogleApis, requestDriveToken, openDrivePicker } from '../lib/googleDrive';
import './VideoPlayer.css';

interface PlaybackState {
  status: 'playing' | 'paused';
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  updatedAt: number;
  updatedBy: string;
  action: 'play' | 'pause' | 'seek' | 'heartbeat';
  seq: number;
}

interface VideoMetadata {
  source: 'manual' | 'drive-oauth';
  driveFileId?: string;
  name?: string;
  mimeType?: string;
  previewUrl?: string;
  directUrl?: string; // for manual URLs
  updatedAt?: number;
  updatedBy?: string;
}

interface VideoPlayerProps {
  roomId: string;
  nickname: string;
  googleToken: string;
  setGoogleToken: (token: string) => void;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
const GOOGLE_APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || '';
const DRIVE_STREAM_BASE_URL = import.meta.env.VITE_DRIVE_STREAM_BASE_URL || '';

export default function VideoPlayer({ roomId, nickname, googleToken, setGoogleToken }: VideoPlayerProps) {
  const [videoInfo, setVideoInfo] = useState<VideoMetadata | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [hostId, setHostId] = useState<string>('');
  
  // Unique client ID to prevent self-syncing loops
  const [userId] = useState<string>(() => {
    let id = localStorage.getItem('watchparty_userid');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('watchparty_userid', id);
    }
    return id;
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Flag to avoid infinite sync feedback loops
  const isApplyingRemoteRef = useRef(false);
  
  // Sequence tracker ref for playback actions
  const lastSeqRef = useRef<number>(0);

  // Computed player mode: 'iframe', 'drive-proxy-html5', or 'manual-html5'
  const playerMode = useIframeFallback 
    ? 'iframe' 
    : (videoInfo?.source === 'drive-oauth' ? 'drive-proxy-html5' : 'manual-html5');

  // 1. Listen for Video changes
  useEffect(() => {
    if (!isConfigured || !database) {
      return;
    }

    const videoRefDb = ref(database, `rooms/${roomId}/video`);
    const unsubscribeVideo = onValue(videoRefDb, (snapshot) => {
      const videoData = snapshot.val() as VideoMetadata;
      if (videoData) {
        setVideoInfo(videoData);
        // Reset player states
        setUseIframeFallback(false);
        setVideoError(null);
        setShowAutoplayOverlay(false);
      } else {
        // Fallback to legacy videoUrl if video object is null
        const legacyUrlRef = ref(database, `rooms/${roomId}/videoUrl`);
        onValue(legacyUrlRef, (urlSnapshot) => {
          const url = urlSnapshot.val();
          if (url) {
            setVideoInfo({ source: 'manual', directUrl: url });
            setUseIframeFallback(false);
            setVideoError(null);
            setShowAutoplayOverlay(false);
          } else {
            setVideoInfo(null);
          }
        }, { onlyOnce: true });
      }
    });

    return () => {
      unsubscribeVideo();
    };
  }, [roomId]);

  // 2. Listen for Room Host ID changes
  useEffect(() => {
    if (!isConfigured || !database) {
      return;
    }

    const hostRef = ref(database, `rooms/${roomId}/hostId`);
    const unsubscribe = onValue(hostRef, (snapshot) => {
      setHostId(snapshot.val() || '');
    });

    return () => unsubscribe();
  }, [roomId]);

  // 3. Listen for Playback synchronization events
  useEffect(() => {
    if (!isConfigured || !database || !videoInfo || playerMode === 'iframe') return;

    // Do not sync playback if in drive-oauth mode and we don't have token
    if (videoInfo.source === 'drive-oauth' && !googleToken) return;

    const playbackRef = ref(database, `rooms/${roomId}/playback`);
    const unsubscribe = onValue(playbackRef, (snapshot) => {
      const state = snapshot.val() as PlaybackState;
      if (!state || !videoRef.current) return;

      // Update sequence tracker with the latest remote sequence
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq;
      }

      // Rule 9: Ignore if:
      // - updatedBy === userId
      // - playerMode === "iframe"
      // - videoRef.current does not exist
      if (state.updatedBy === userId) return;
      if (!videoRef.current) return;

      console.log(`[playback] receive payload`, state);

      // Lock local events trigger while applying remote update
      isApplyingRemoteRef.current = true;

      // Sync current time if out of sync by more than 1 second
      const diff = Math.abs(videoRef.current.currentTime - state.currentTime);
      if (diff > 1) {
        videoRef.current.currentTime = state.currentTime;
      }

      // Rule 8: Determine target play/pause state using status first and falls back to isPlaying
      const shouldPlay = state.status === 'playing' || state.isPlaying === true;

      // Sync playing state
      if (shouldPlay && videoRef.current.paused) {
        videoRef.current.play().then(() => {
          console.log(`[playback] remote play applied`);
          setShowAutoplayOverlay(false);
        }).catch((err) => {
          console.warn(`[playback] remote play blocked`, err);
          setShowAutoplayOverlay(true);
        });
      } else if (!shouldPlay && !videoRef.current.paused) {
        console.log(`[playback] remote pause applied`);
        videoRef.current.pause();
      }

      // Release local event lock
      setTimeout(() => {
        isApplyingRemoteRef.current = false;
      }, 300);
    });

    return () => unsubscribe();
  }, [roomId, videoInfo, playerMode, userId, googleToken]);

  // 4. Heartbeat update every 4 seconds when playing to keep in sync (Only Host sends)
  useEffect(() => {
    const interval = setInterval(() => {
      if (hostId === userId && videoRef.current && !videoRef.current.paused && playerMode !== 'iframe') {
        updatePlaybackState('heartbeat', true, videoRef.current.currentTime);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [roomId, playerMode, userId, videoInfo, hostId]);

  // Helper to extract Google Drive file ID from legacy links
  const getGoogleDriveId = (url: string): string | null => {
    const driveRegExp = /(?:https?:\/\/)?(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/;
    const match = url.match(driveRegExp);
    return match ? match[1] : null;
  };

  // Convert videoInfo into streaming and preview links
  const getProcessedUrls = () => {
    if (!videoInfo) return { stream: '', preview: '' };

    if (videoInfo.source === 'drive-oauth') {
      // Requirement 6: Build URL pointing to Firebase Cloud Function driveStream proxy
      const stream = googleToken && videoInfo.driveFileId 
        ? `${DRIVE_STREAM_BASE_URL}?fileId=${videoInfo.driveFileId}&accessToken=${encodeURIComponent(googleToken)}`
        : '';
      return {
        stream,
        preview: videoInfo.previewUrl || ''
      };
    } else {
      // Manual URL
      const url = videoInfo.directUrl || '';
      const fileId = getGoogleDriveId(url);
      if (fileId) {
        return {
          stream: `https://docs.google.com/uc?export=download&id=${fileId}`,
          preview: `https://drive.google.com/file/d/${fileId}/preview`
        };
      }
      return { stream: url, preview: url };
    }
  };

  const processed = getProcessedUrls();

  // Send local playback state to Firebase Realtime Database
  const updatePlaybackState = (
    action: 'play' | 'pause' | 'seek' | 'heartbeat',
    explicitIsPlaying?: boolean,
    explicitCurrentTime?: number
  ) => {
    if (!isConfigured || !database || !videoRef.current || playerMode === 'iframe') return;
    
    // Ignore local events triggered by incoming Firebase remote syncs
    if (isApplyingRemoteRef.current) return;

    // Rule 7: Only the room host can update the playback state
    if (hostId && hostId !== userId) {
      return;
    }

    const isPlaying = explicitIsPlaying !== undefined ? explicitIsPlaying : !videoRef.current.paused;
    const status = isPlaying ? 'playing' : 'paused';
    const currentTime = explicitCurrentTime !== undefined ? explicitCurrentTime : videoRef.current.currentTime;
    const duration = videoRef.current.duration || 0;
    const updatedAt = Date.now();
    
    // Increment sequence number
    const nextSeq = lastSeqRef.current + 1;
    lastSeqRef.current = nextSeq;

    const payload: PlaybackState = {
      status,
      isPlaying,
      currentTime,
      duration,
      updatedAt,
      updatedBy: userId,
      action,
      seq: nextSeq
    };

    console.log(`[playback] send payload (${nickname})`, payload);

    set(ref(database, `rooms/${roomId}/playback`), payload).catch((err) => {
      console.error("Erro ao sincronizar playback no Firebase:", err);
    });
  };

  // HTML5 Video Event Handlers
  const handlePlay = () => {
    updatePlaybackState('play', true, videoRef.current?.currentTime);
  };
  
  const handlePause = () => {
    updatePlaybackState('pause', false, videoRef.current?.currentTime);
  };
  
  const handleSeeked = () => {
    if (!videoRef.current) return;
    const isPlaying = !videoRef.current.paused;
    updatePlaybackState('seek', isPlaying, videoRef.current.currentTime);
  };

  // Verify the reason of streaming failures to identify permission issues (HTTP 403)
  const checkVideoFetchError = async (streamUrl: string) => {
    try {
      const response = await fetch(streamUrl, { method: 'GET', headers: { Range: 'bytes=0-1' } });
      if (response.status === 403 || response.status === 401) {
        setVideoError("Sua conta Google não tem acesso a este arquivo. Peça ao host para compartilhar o vídeo com você ou tornar o arquivo acessível por link.");
      } else if (response.status === 404) {
        setVideoError("Vídeo não encontrado. Verifique se o arquivo ainda existe no Google Drive.");
      } else {
        setUseIframeFallback(true);
      }
    } catch (e) {
      // CORS blocks fetch or network error, fallback to iframe
      setUseIframeFallback(true);
    }
  };

  // Triggered if the <video> source fails to load
  const handleVideoError = () => {
    if (videoInfo?.source === 'drive-oauth') {
      if (processed.stream) {
        checkVideoFetchError(processed.stream);
      } else {
        setVideoError("URL do proxy inválida ou sem token.");
      }
    } else {
      // Legacy URL error fallback
      const url = videoInfo?.directUrl || '';
      const fileId = getGoogleDriveId(url);
      if (fileId && !useIframeFallback) {
        console.warn("Falha no link de streaming direto do Drive. Ativando fallback para Iframe Preview.");
        setUseIframeFallback(true);
      } else {
        setVideoError("Não foi possível carregar o vídeo. Verifique se o link está correto ou se o arquivo é público.");
      }
    }
  };

  // Triggered when submitting manual URL form
  const handleAddVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    const url = inputUrl.trim();
    const videoData: VideoMetadata = {
      source: 'manual',
      directUrl: url,
      updatedAt: Date.now(),
      updatedBy: userId
    };

    if (isConfigured && database) {
      // Rule 7: User who loads the video becomes the host
      set(ref(database, `rooms/${roomId}/hostId`), userId);
      set(ref(database, `rooms/${roomId}/video`), videoData);
      set(ref(database, `rooms/${roomId}/videoUrl`), null);
      
      const nextSeq = lastSeqRef.current + 1;
      lastSeqRef.current = nextSeq;
      set(ref(database, `rooms/${roomId}/playback`), {
        status: 'paused',
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        updatedAt: Date.now(),
        updatedBy: userId,
        action: 'play',
        seq: nextSeq
      });
    } else {
      // Local Demo State
      setHostId(userId);
      setVideoInfo(videoData);
      setUseIframeFallback(false);
      setVideoError(null);
      setShowAutoplayOverlay(false);
    }
    setInputUrl('');
  };

  // Triggered when Google Drive login is clicked by User B (Viewer)
  const handleConnectOnly = async () => {
    if (!GOOGLE_CLIENT_ID) {
      alert("Configuração do Google Client ID ausente.");
      return;
    }
    try {
      await loadGoogleApis();
      const token = await requestDriveToken(GOOGLE_CLIENT_ID);
      setGoogleToken(token);
    } catch (err) {
      console.error("Erro ao conectar Google Drive:", err);
      alert("Falha ao autenticar com a conta do Google.");
    }
  };

  // Triggered when Google Drive picker button is clicked
  const handleGoogleDriveSelect = async () => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY || !GOOGLE_APP_ID) {
      alert("Integração do Google Drive não configurada no servidor. Verifique o arquivo .env.local.");
      return;
    }

    try {
      await loadGoogleApis();
      let token = googleToken;
      if (!token) {
        token = await requestDriveToken(GOOGLE_CLIENT_ID);
        setGoogleToken(token);
      }

      openDrivePicker({
        apiKey: GOOGLE_API_KEY,
        appId: GOOGLE_APP_ID,
        token: token,
        onSelect: (file) => {
          const videoData: VideoMetadata = {
            source: 'drive-oauth',
            driveFileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            previewUrl: file.embedUrl,
            updatedAt: Date.now(),
            updatedBy: userId
          };

          if (isConfigured && database) {
            // Rule 7: User who loads the video becomes the host
            set(ref(database, `rooms/${roomId}/hostId`), userId);
            set(ref(database, `rooms/${roomId}/video`), videoData);
            set(ref(database, `rooms/${roomId}/videoUrl`), null);
            
            const nextSeq = lastSeqRef.current + 1;
            lastSeqRef.current = nextSeq;
            set(ref(database, `rooms/${roomId}/playback`), {
              status: 'paused',
              isPlaying: false,
              currentTime: 0,
              duration: 0,
              updatedAt: Date.now(),
              updatedBy: userId,
              action: 'play',
              seq: nextSeq
            });
          } else {
            setHostId(userId);
            setVideoInfo(videoData);
            setUseIframeFallback(false);
            setVideoError(null);
            setShowAutoplayOverlay(false);
          }
        }
      });
    } catch (err) {
      console.error("Erro na integração do Google Drive:", err);
      alert("Erro ao abrir seletor do Google Drive. Detalhes no console dev.");
    }
  };

  const handleRemoveVideo = () => {
    if (isConfigured && database) {
      set(ref(database, `rooms/${roomId}/hostId`), null);
      set(ref(database, `rooms/${roomId}/video`), null);
      set(ref(database, `rooms/${roomId}/videoUrl`), null);
      set(ref(database, `rooms/${roomId}/playback`), null);
    } else {
      setHostId('');
      setVideoInfo(null);
      setUseIframeFallback(false);
      setVideoError(null);
      setShowAutoplayOverlay(false);
    }
  };

  // Interactive play overlay click handler (to unlock blocked browser audio context)
  const handleEnableAutoplay = () => {
    if (videoRef.current) {
      videoRef.current.play().then(() => {
        setShowAutoplayOverlay(false);
        console.log("[playback] Autoplay habilitado pelo usuário.");
      }).catch((err) => {
        console.error("Autoplay ainda bloqueado pelo navegador:", err);
      });
    }
  };

  // 1. URL Input View (No video loaded)
  if (!videoInfo) {
    return (
      <div className="player-empty-state glass animate-fade-in">
        <div className="empty-content">
          <div className="link-icon-container">
            <Link2 size={32} className="purple-glow-icon" />
          </div>
          <h2>Adicionar Vídeo</h2>
          <p>Selecione um arquivo de vídeo do seu Google Drive ou cole um link de vídeo direto (.mp4, .webm).</p>
          
          <div className="picker-button-container">
            <button onClick={handleGoogleDriveSelect} className="btn btn-primary w-full">
              📂 Escolher do Google Drive
            </button>
          </div>

          <div className="divider-container">
            <span className="divider-line"></span>
            <span className="divider-text">ou use link direto</span>
            <span className="divider-line"></span>
          </div>

          <form onSubmit={handleAddVideo} className="url-form">
            <input
              type="url"
              className="input-field url-input"
              placeholder="https://exemplo.com/filme.mp4"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-secondary w-full">
              Carregar Link
            </button>
          </form>

          <div className="instructions-card">
            <h4>💡 Dica para Testes Rápidos</h4>
            <p>Você pode testar colando o vídeo local de demonstração: <code>/test-video.mp4</code></p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Drive OAuth block if other participant doesn't have token loaded in browser session
  if (videoInfo.source === 'drive-oauth' && !googleToken) {
    return (
      <div className="player-empty-state glass animate-fade-in">
        <div className="empty-content">
          <div className="link-icon-container">
            <Info size={32} className="purple-glow-icon" />
          </div>
          <h2>Vídeo do Google Drive Selecionado</h2>
          <p>O arquivo <strong>"{videoInfo.name}"</strong> está compartilhado nesta sala.</p>
          <p className="sub-note">Conecte sua conta do Google para carregar o reprodutor e assistir.</p>
          
          <button onClick={handleConnectOnly} className="btn btn-primary w-full connect-drive-btn">
            🔑 Conectar Google Drive
          </button>
        </div>
      </div>
    );
  }

  // 3. Playback View (HTML5 video element or iframe fallback)
  return (
    <div className="player-wrapper glass">
      {/* Video Title Bar */}
      <div className="player-header">
        <div className="video-title-info">
          <Play size={16} className="brand-color-icon" />
          <span className="video-title">
            {videoInfo.source === 'drive-oauth' ? `Drive: ${videoInfo.name}` : 'Vídeo Compartilhado'}
          </span>
        </div>
        <button onClick={handleRemoveVideo} className="btn-change-video">
          Trocar Vídeo
        </button>
      </div>

      {/* Main viewport */}
      <div className="video-viewport">
        {videoError ? (
          <div className="video-error-state">
            <AlertCircle size={40} className="error-icon" />
            <p>{videoError}</p>
            <button onClick={() => setVideoError(null)} className="btn btn-secondary btn-sm">
              Tentar Novamente
            </button>
          </div>
        ) : playerMode === 'iframe' ? (
          /* Iframe Fallback for Google Drive preview */
          <div className="iframe-container">
            <iframe
              src={processed.preview}
              title="Google Drive Video Preview"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="video-iframe"
            />
            <div className="iframe-sync-banner">
              <Info size={16} />
              <span>
                <strong>Fallback iframe: chat sincronizado, mas play/pause/tempo não podem ser controlados automaticamente.</strong>
              </span>
            </div>
          </div>
        ) : (
          /* Standard HTML5 Sync Player (using stream proxy) */
          <div className="video-element-container">
            <video
              ref={videoRef}
              src={processed.stream}
              controls={true}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeeked}
              onError={handleVideoError}
              className="video-element"
            />
            
            {showAutoplayOverlay && (
              <div className="autoplay-overlay glass">
                <p>O navegador bloqueou a reprodução automática sincronizada.</p>
                <button onClick={handleEnableAutoplay} className="btn btn-primary btn-sm">
                  Clique para ativar a sincronia
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sinc Status */}
      <div className="player-sync-footer">
        <span className={`sync-badge ${playerMode === 'iframe' ? 'orange' : 'green'}`}>
          <span className="pulse-dot"></span>
          {playerMode === 'drive-proxy-html5' ? (
            'Modo Drive OAuth HTML5 via Proxy: sincronização automática ativa'
          ) : playerMode === 'iframe' ? (
            'Modo Google Drive iframe: somente chat sincronizado'
          ) : (
            'Modo HTML5: sincronização automática ativa'
          )}
        </span>
        <span className="sync-note">
          {playerMode === 'iframe' 
            ? 'Fallback iframe: chat sincronizado, mas play/pause/tempo não podem ser controlados automaticamente.'
            : 'Play, pause e tempo estão sincronizados entre os participantes.'}
        </span>
      </div>
    </div>
  );
}
