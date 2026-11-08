import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  Link2,
  AlertCircle,
  Info,
  Users,
  Video,
  RefreshCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Subtitles,
  MessageSquare,
  MessageSquareOff,
  CheckCircle2,
  Sparkles,
  RotateCcw,
  RotateCw,
  Upload,
  Lock,
  PictureInPicture2,
  FolderOpen,
  ArrowRight,
  Crown,
  ClipboardCopy,
  Lightbulb
} from 'lucide-react';
import { database, isConfigured, auth, clientUserId } from '../firebase';
import { ref, onValue, set, push, onDisconnect } from 'firebase/database';
import {
  loadGoogleApis,
  requestDriveToken,
  openDrivePicker,
  ensureDriveServiceWorker,
  getDriveServiceWorkerStreamUrl,
  getDriveCloudProxyStreamUrl
} from '../lib/googleDrive';
import { parseSubtitles, formatDuration, type SubtitleCue } from '../lib/subtitles';
import {
  playPopSound,
  playChimeSound,
  playCountdownBeep,
  playActionChord,
  isSoundEnabled,
  setSoundEnabled
} from '../lib/soundEffects';
import './VideoPlayer.css';

interface PlaybackState {
  status: 'playing' | 'paused';
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  updatedAt: number;
  updatedBy: string;
  updatedByName?: string;
  action: 'play' | 'pause' | 'seek' | 'heartbeat';
  seq: number;
}

interface VideoMetadata {
  source: 'manual' | 'drive-oauth' | 'youtube';
  driveFileId?: string;
  youtubeId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  accessToken?: string;
  previewUrl?: string;
  directUrl?: string;
  updatedAt?: number;
  updatedBy?: string;
}

interface RoomSettings {
  controlMode: 'anyone' | 'host';
  pin?: string;
  roomTitle?: string;
}

interface SharedSubtitleData {
  name: string;
  content: string;
  uploadedBy: string;
  updatedAt: number;
}

interface LobbyParticipant {
  nickname: string;
  ready: boolean;
  isHost: boolean;
  updatedAt: number;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  sender: string;
  leftPercent: number;
}

interface ScreenChatToast {
  id: string;
  sender: string;
  text: string;
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
const DRIVE_STREAM_BASE_URL =
  import.meta.env.VITE_DRIVE_STREAM_BASE_URL || 'https://drivestream-cbn5bsdmea-uc.a.run.app';

const REACTION_EMOJIS = ['❤️', '😂', '😱', '😭', '🔥', '🍿'];

// Helper to load the YouTube IFrame Player API once
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  const win = window as any;
  if (win.YT && win.YT.Player) {
    return Promise.resolve(win.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prevCallback = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve(win.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
  });
  return ytApiPromise;
}

// Helper to extract YouTube Video ID from various YouTube URL formats
function getYouTubeId(url: string): string | null {
  const regExp =
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

// Helper to extract Google Drive file ID from share links
function getGoogleDriveId(url: string): string | null {
  const driveRegExp =
    /(?:https?:\/\/)?(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([a-zA-Z0-9_-]+)/;
  const match = url.match(driveRegExp);
  return match ? match[1] : null;
}

export default function VideoPlayer({
  roomId,
  nickname,
  googleToken,
  setGoogleToken
}: VideoPlayerProps) {
  const [videoInfo, setVideoInfo] = useState<VideoMetadata | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [useCloudProxyFallback, setUseCloudProxyFallback] = useState(false);
  const [swStatus, setSwStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [isAutoplayMuted, setIsAutoplayMuted] = useState(false);
  const [hostId, setHostId] = useState<string>('');
  const [controlMode, setControlMode] = useState<'anyone' | 'host'>('anyone');
  const [roomSettingsExtra, setRoomSettingsExtra] = useState<{ pin?: string; roomTitle?: string }>({});
  const [ytReady, setYtReady] = useState(false);

  // Local HUD & Media States (visible to both Host and Guests!)
  const [localIsPlaying, setLocalIsPlaying] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('watchparty_volume');
    return saved !== null ? Number(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [videoFilter, setVideoFilter] = useState<'none' | 'cinema' | 'sharp' | 'night'>('none');
  const [ytQuality, setYtQuality] = useState<string>('hd1080');
  const [pausedByName, setPausedByName] = useState<string>('');

  // Subtitles State (.SRT / .VTT synced across room)
  const [sharedSubtitle, setSharedSubtitle] = useState<SharedSubtitleData | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleSize, setSubtitleSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState<number>(0);

  // Fullscreen / Screen Chat Overlay State
  const [showChatOnScreen, setShowChatOnScreen] = useState<boolean>(() => {
    const saved = localStorage.getItem('watchparty_chat_overlay');
    return saved !== null ? saved === 'true' : true;
  });
  const [screenChatToasts, setScreenChatToasts] = useState<ScreenChatToast[]>([]);

  // Floating Reactions State
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Lobby Ready & Countdown State
  const [participants, setParticipants] = useState<Record<string, LobbyParticipant>>({});
  const [isReady, setIsReady] = useState<boolean>(false);
  const [countdownStep, setCountdownStep] = useState<string | null>(null);
  const [theaterLightsOff, setTheaterLightsOff] = useState<boolean>(false);
  const [soundActive, setSoundActive] = useState<boolean>(() => isSoundEnabled());

  // Toggle theater lights mode on document.body for cinema atmosphere
  useEffect(() => {
    if (theaterLightsOff) {
      document.body.classList.add('theater-lights-dimmed');
    } else {
      document.body.classList.remove('theater-lights-dimmed');
    }
    return () => {
      document.body.classList.remove('theater-lights-dimmed');
    };
  }, [theaterLightsOff]);

  // Unique client ID per tab/session
  const [userId] = useState<string>(() => {
    return auth?.currentUser?.uid || clientUserId;
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const hudTimeoutRef = useRef<number | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const chatInitializedRef = useRef<boolean>(false);
  const lastCountdownRef = useRef<number>(0);

  // Flag to avoid infinite sync feedback loops when applying remote state
  const isApplyingRemoteRef = useRef(false);
  const applyLockTimeoutRef = useRef<number | null>(null);

  // Sequence tracker ref for playback actions
  const lastSeqRef = useRef<number>(0);

  // Latest playback state from Firebase so media can sync immediately when loaded
  const latestPlaybackRef = useRef<PlaybackState | null>(null);

  // Firebase server time offset in ms (serverNow = Date.now() + serverOffsetRef.current)
  const serverOffsetRef = useRef<number>(0);

  // Keep refs of permissions for event callbacks
  const canControlRef = useRef<boolean>(true);
  const hostIdRef = useRef<string>('');
  const controlModeRef = useRef<'anyone' | 'host'>('anyone');

  const isHost = !hostId || hostId === userId;
  const canControl = controlMode === 'anyone' || isHost;

  // Effective Drive token: shared room token from the video owner OR local user's token
  const effectiveDriveToken = videoInfo?.accessToken || googleToken || '';

  useEffect(() => {
    canControlRef.current = canControl;
    hostIdRef.current = hostId;
    controlModeRef.current = controlMode;
  }, [canControl, hostId, controlMode]);

  // Register Service Worker for $0 direct Google Drive streaming
  useEffect(() => {
    let cancelled = false;
    ensureDriveServiceWorker().then((ok) => {
      if (!cancelled) {
        setSwStatus(ok ? 'ready' : 'unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track Firebase server clock offset to eliminate clock skew between PC and mobile
  useEffect(() => {
    if (!isConfigured || !database) return;
    const offsetRef = ref(database, '.info/serverTimeOffset');
    const unsub = onValue(offsetRef, (snap) => {
      serverOffsetRef.current = Number(snap.val()) || 0;
    });
    return () => unsub();
  }, []);

  const getServerNow = useCallback(() => {
    return Date.now() + serverOffsetRef.current;
  }, []);

  // Computed player mode: 'youtube', 'iframe', 'drive-proxy-html5', or 'manual-html5'
  const playerMode =
    videoInfo?.source === 'youtube'
      ? 'youtube'
      : useIframeFallback
      ? 'iframe'
      : videoInfo?.source === 'drive-oauth'
      ? 'drive-proxy-html5'
      : 'manual-html5';

  // Auto-hide HUD after 3.2s of mouse inactivity while playing
  const pokeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimeoutRef.current) {
      window.clearTimeout(hudTimeoutRef.current);
    }
    hudTimeoutRef.current = window.setTimeout(() => {
      if (localIsPlaying && !showSettingsMenu) {
        setHudVisible(false);
      }
    }, 3200);
  }, [localIsPlaying, showSettingsMenu]);

  useEffect(() => {
    if (!localIsPlaying || showSettingsMenu) {
      setHudVisible(true);
    }
  }, [localIsPlaying, showSettingsMenu]);

  // Track Fullscreen changes on document
  useEffect(() => {
    const onFsChange = () => {
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        null;
      setIsFullscreen(Boolean(fsEl));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const lockRemoteApply = useCallback((ms = 750) => {
    isApplyingRemoteRef.current = true;
    if (applyLockTimeoutRef.current) {
      window.clearTimeout(applyLockTimeoutRef.current);
    }
    applyLockTimeoutRef.current = window.setTimeout(() => {
      isApplyingRemoteRef.current = false;
    }, ms);
  }, []);

  // Core function to write playback state to Firebase
  const sendPlaybackPayload = useCallback(
    (
      action: 'play' | 'pause' | 'seek' | 'heartbeat',
      isPlaying: boolean,
      currentTime: number,
      duration: number
    ) => {
      if (!isConfigured || !database || playerMode === 'iframe') return;
      if (isApplyingRemoteRef.current) return;
      if (!canControlRef.current) return;

      const status = isPlaying ? 'playing' : 'paused';
      const updatedAt = getServerNow();
      const nextSeq = lastSeqRef.current + 1;
      lastSeqRef.current = nextSeq;

      const payload: PlaybackState = {
        status,
        isPlaying,
        currentTime,
        duration: duration || 0,
        updatedAt,
        updatedBy: userId,
        updatedByName: nickname || 'Host',
        action,
        seq: nextSeq
      };

      latestPlaybackRef.current = payload;
      setLocalIsPlaying(isPlaying);
      if (!isPlaying) {
        setPausedByName(nickname || 'Você');
      }

      set(ref(database, `rooms/${roomId}/playback`), payload).catch((err) => {
        console.error('Erro ao sincronizar playback no Firebase:', err);
      });
    },
    [playerMode, roomId, userId, nickname, getServerNow]
  );

  // Apply a remote PlaybackState to whichever player is active (HTML5 or YouTube)
  const applyPlaybackToMedia = useCallback(
    (state: PlaybackState, forceApply = false) => {
      if (!state) return;

      const shouldPlay = state.status === 'playing' || state.isPlaying === true;
      setLocalIsPlaying(shouldPlay);
      if (!shouldPlay && state.updatedByName) {
        setPausedByName(state.updatedByName);
      }
      if (state.duration && state.duration > 0) {
        setLocalDuration((prev) => (prev > 0 ? prev : state.duration));
      }

      if (!forceApply && state.updatedBy === userId) return;

      const elapsedSec =
        shouldPlay && state.updatedAt
          ? Math.max(0, (getServerNow() - state.updatedAt) / 1000)
          : 0;
      const targetTime = Math.max(0, (state.currentTime || 0) + elapsedSec);

      if (videoInfo?.source === 'youtube') {
        const yt = ytPlayerRef.current;
        if (!yt || typeof yt.getCurrentTime !== 'function') return;

        const currentTime = yt.getCurrentTime() || 0;
        const diff = Math.abs(currentTime - targetTime);
        const tolerance = state.action === 'heartbeat' ? 2.2 : 1.0;
        const playerState = yt.getPlayerState?.();

        const needsSeek = diff > tolerance || forceApply;
        const needsPlay = shouldPlay && playerState !== 1 && playerState !== 3;
        const needsPause = !shouldPlay && (playerState === 1 || playerState === 3);

        if (!needsSeek && !needsPlay && !needsPause) return;

        lockRemoteApply(850);

        if (needsSeek) {
          yt.seekTo(targetTime, true);
          setLocalCurrentTime(targetTime);
        }

        if (needsPlay) {
          yt.playVideo();
          setShowAutoplayOverlay(false);
        } else if (needsPause) {
          yt.pauseVideo();
        }
        return;
      }

      if (playerMode === 'iframe') return;
      const videoEl = videoRef.current;
      if (!videoEl) return;

      const diff = Math.abs(videoEl.currentTime - targetTime);
      const tolerance = state.action === 'heartbeat' ? 2.2 : 0.9;

      const needsSeek = (diff > tolerance || forceApply) && videoEl.readyState >= 1;
      const needsPlay = shouldPlay && videoEl.paused;
      const needsPause = !shouldPlay && !videoEl.paused;

      if (!needsSeek && !needsPlay && !needsPause) return;

      lockRemoteApply(800);

      if (needsSeek) {
        try {
          videoEl.currentTime = targetTime;
          setLocalCurrentTime(targetTime);
        } catch {
          // Metadata not ready yet; onLoadedMetadata/onCanPlay will apply it
        }
      }

      if (needsPlay) {
        videoEl
          .play()
          .then(() => {
            setShowAutoplayOverlay(false);
          })
          .catch(() => {
            // Browser blocked unmuted autoplay: immediately play MUTED so video stays 100% in sync!
            if (videoRef.current) {
              lockRemoteApply(800);
              videoRef.current.muted = true;
              setIsMuted(true);
              setIsAutoplayMuted(true);
              videoRef.current
                .play()
                .then(() => {
                  setShowAutoplayOverlay(false);
                })
                .catch((err2) => {
                  console.warn('[playback] remote play blocked even when muted', err2);
                  setShowAutoplayOverlay(true);
                });
            }
          });
      } else if (needsPause) {
        videoEl.pause();
      }
    },
    [userId, videoInfo?.source, playerMode, lockRemoteApply, getServerNow]
  );

  // 1. Listen for Video changes
  useEffect(() => {
    if (!isConfigured || !database) {
      return;
    }

    const videoRefDb = ref(database, `rooms/${roomId}/video`);
    const unsubscribeVideo = onValue(videoRefDb, (snapshot) => {
      const videoData = snapshot.val() as VideoMetadata;
      if (videoData) {
        setVideoInfo((prev) => {
          const isDifferentVideo =
            prev?.driveFileId !== videoData.driveFileId ||
            prev?.youtubeId !== videoData.youtubeId ||
            prev?.directUrl !== videoData.directUrl ||
            prev?.source !== videoData.source;
          if (isDifferentVideo) {
            setUseIframeFallback(false);
            setUseCloudProxyFallback(false);
            setVideoError(null);
            setShowAutoplayOverlay(false);
            setIsAutoplayMuted(false);
            setLocalCurrentTime(0);
            setLocalDuration(0);
            setBufferedPercent(0);
          }
          return videoData;
        });
      } else {
        const legacyUrlRef = ref(database, `rooms/${roomId}/videoUrl`);
        onValue(
          legacyUrlRef,
          (urlSnapshot) => {
            const url = urlSnapshot.val();
            if (url) {
              const ytId = getYouTubeId(url);
              if (ytId) {
                setVideoInfo({
                  source: 'youtube',
                  youtubeId: ytId,
                  directUrl: url,
                  name: `YouTube (${ytId})`
                });
              } else {
                setVideoInfo({ source: 'manual', directUrl: url });
              }
              setUseIframeFallback(false);
              setUseCloudProxyFallback(false);
              setVideoError(null);
              setShowAutoplayOverlay(false);
            } else {
              setVideoInfo(null);
            }
          },
          { onlyOnce: true }
        );
      }
    });

    return () => {
      unsubscribeVideo();
    };
  }, [roomId]);

  // 2. Listen for Room Host ID and Room Settings (controlMode, pin, roomTitle)
  useEffect(() => {
    if (!isConfigured || !database) {
      return;
    }

    const hostRef = ref(database, `rooms/${roomId}/hostId`);
    const unsubHost = onValue(hostRef, (snapshot) => {
      setHostId(snapshot.val() || '');
    });

    const settingsRef = ref(database, `rooms/${roomId}/settings`);
    const unsubSettings = onValue(settingsRef, (snapshot) => {
      const val = snapshot.val() as RoomSettings | null;
      if (val && (val.controlMode === 'anyone' || val.controlMode === 'host')) {
        setControlMode(val.controlMode);
        setRoomSettingsExtra({
          ...(val.pin ? { pin: val.pin } : {}),
          ...(val.roomTitle ? { roomTitle: val.roomTitle } : {})
        });
      } else {
        setControlMode('anyone');
      }
    });

    return () => {
      unsubHost();
      unsubSettings();
    };
  }, [roomId]);

  // 2B. Register Lobby Participant Presence & Listen to Lobby + Countdown + Subtitles + Reactions + Fullscreen Chat
  useEffect(() => {
    if (!isConfigured || !database || !roomId) return;

    const myParticipantRef = ref(database, `rooms/${roomId}/lobby/participants/${userId}`);
    set(myParticipantRef, {
      nickname: nickname || 'Convidado',
      ready: isReady,
      isHost,
      updatedAt: Date.now()
    }).catch(() => {});

    try {
      onDisconnect(myParticipantRef).remove();
    } catch {
      // ignore onDisconnect errors
    }

    const participantsRef = ref(database, `rooms/${roomId}/lobby/participants`);
    const unsubParticipants = onValue(participantsRef, (snap) => {
      setParticipants(snap.val() || {});
    });

    const countdownRef = ref(database, `rooms/${roomId}/lobby/countdown`);
    const unsubCountdown = onValue(countdownRef, (snap) => {
      const data = snap.val();
      if (!data || !data.startedAt) return;
      if (data.startedAt <= lastCountdownRef.current) return;
      // Only trigger if started within the last 10 seconds
      if (Math.abs(getServerNow() - data.startedAt) > 10000) {
        lastCountdownRef.current = data.startedAt;
        return;
      }
      playCountdownBeep(3);
      setCountdownStep('3');
      window.setTimeout(() => {
        playCountdownBeep(2);
        setCountdownStep('2');
      }, 1000);
      window.setTimeout(() => {
        playCountdownBeep(1);
        setCountdownStep('1');
      }, 2000);
      window.setTimeout(() => {
        playActionChord();
        setCountdownStep('🍿 AÇÃO!');
        if (canControlRef.current && (isHost || data.startedBy === userId)) {
          if (videoInfo?.source === 'youtube' && ytPlayerRef.current?.playVideo) {
            ytPlayerRef.current.playVideo();
            sendPlaybackPayload(
              'play',
              true,
              ytPlayerRef.current.getCurrentTime?.() || 0,
              ytPlayerRef.current.getDuration?.() || 0
            );
          } else if (videoRef.current) {
            videoRef.current.play().catch(() => {});
            sendPlaybackPayload(
              'play',
              true,
              videoRef.current.currentTime || 0,
              videoRef.current.duration || 0
            );
          }
        }
      }, 3000);
      window.setTimeout(() => setCountdownStep(null), 4200);
    });

    const subtitleRef = ref(database, `rooms/${roomId}/subtitle`);
    const unsubSubtitle = onValue(subtitleRef, (snap) => {
      setSharedSubtitle(snap.val() || null);
    });

    const reactionsRef = ref(database, `rooms/${roomId}/reactions`);
    const unsubReactions = onValue(reactionsRef, (snap) => {
      const val = snap.val();
      if (!val) return;
      const keys = Object.keys(val);
      const latestKey = keys[keys.length - 1];
      if (!latestKey) return;
      const item = val[latestKey];
      if (!item || Math.abs(Date.now() - item.timestamp) > 8000) return;

      const reactionId = `${latestKey}`;
      playPopSound();
      setFloatingReactions((prev) => {
        if (prev.some((r) => r.id === reactionId)) return prev;
        const next: FloatingReaction = {
          id: reactionId,
          emoji: item.emoji,
          sender: item.sender,
          leftPercent: 15 + Math.floor(Math.random() * 70)
        };
        return [...prev.slice(-10), next];
      });

      window.setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== reactionId));
      }, 3400);
    });

    // Listen for new chat messages to display at the bottom of the video screen (especially in Fullscreen!)
    const chatRef = ref(database, `rooms/${roomId}/chat`);
    const unsubChat = onValue(chatRef, (snap) => {
      const data = snap.val();
      if (!data) {
        chatInitializedRef.current = true;
        return;
      }
      const keys = Object.keys(data);
      if (!chatInitializedRef.current) {
        keys.forEach((k) => seenChatIdsRef.current.add(k));
        chatInitializedRef.current = true;
        return;
      }

      keys.forEach((k) => {
        if (!seenChatIdsRef.current.has(k)) {
          seenChatIdsRef.current.add(k);
          const msg = data[k];
          if (msg && msg.text) {
            const toastId = k;
            setScreenChatToasts((prev) => [
              ...prev.slice(-2),
              { id: toastId, sender: msg.sender || 'Convidado', text: msg.text }
            ]);
            window.setTimeout(() => {
              setScreenChatToasts((prev) => prev.filter((t) => t.id !== toastId));
            }, 5500);
          }
        }
      });
    });

    return () => {
      unsubParticipants();
      unsubCountdown();
      unsubSubtitle();
      unsubReactions();
      unsubChat();
    };
  }, [
    roomId,
    userId,
    nickname,
    isReady,
    isHost,
    videoInfo?.source,
    getServerNow,
    sendPlaybackPayload
  ]);

  // 3. Initialize / Manage YouTube IFrame Player when source === 'youtube'
  useEffect(() => {
    if (videoInfo?.source !== 'youtube' || !videoInfo.youtubeId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
      setYtReady(false);
      return;
    }

    let cancelled = false;
    const videoId = videoInfo.youtubeId;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !ytContainerRef.current) return;

      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }

      ytContainerRef.current.innerHTML = '';
      const mountEl = document.createElement('div');
      ytContainerRef.current.appendChild(mountEl);

      ytPlayerRef.current = new YT.Player(mountEl, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setYtReady(true);
            const dur = ytPlayerRef.current?.getDuration?.() || 0;
            if (dur > 0) setLocalDuration(dur);
            if (latestPlaybackRef.current) {
              applyPlaybackToMedia(latestPlaybackRef.current, true);
            }
          },
          onStateChange: (event: any) => {
            if (cancelled) return;
            const player = event.target;
            const stateCode = event.data;
            const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            const duration = player.getDuration ? player.getDuration() : 0;
            if (duration > 0) setLocalDuration(duration);
            setLocalCurrentTime(currentTime);
            setLocalIsPlaying(stateCode === 1);

            if (isApplyingRemoteRef.current) return;

            if (!canControlRef.current) {
              if (latestPlaybackRef.current) {
                applyPlaybackToMedia(latestPlaybackRef.current, true);
              }
              return;
            }

            if (stateCode === 1) {
              sendPlaybackPayload('play', true, currentTime, duration);
            } else if (stateCode === 2) {
              sendPlaybackPayload('pause', false, currentTime, duration);
            }
          },
          onError: () => {
            if (cancelled) return;
            setVideoError(
              'Não foi possível reproduzir este vídeo do YouTube (pode ter restrição de incorporação).'
            );
          }
        }
      });
    });

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
      setYtReady(false);
    };
  }, [videoInfo?.source, videoInfo?.youtubeId, applyPlaybackToMedia, sendPlaybackPayload]);

  // Poll YouTube currentTime for the custom HUD when YouTube is active
  useEffect(() => {
    if (videoInfo?.source !== 'youtube' || !ytReady) return;
    const timer = window.setInterval(() => {
      const yt = ytPlayerRef.current;
      if (yt && typeof yt.getCurrentTime === 'function') {
        setLocalCurrentTime(yt.getCurrentTime() || 0);
        const d = yt.getDuration?.() || 0;
        if (d > 0) setLocalDuration(d);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [videoInfo?.source, ytReady]);

  // 4. Listen for Playback synchronization events from Firebase
  useEffect(() => {
    if (!isConfigured || !database || !videoInfo || playerMode === 'iframe') return;
    if (videoInfo.source === 'drive-oauth' && !effectiveDriveToken) return;

    const playbackRef = ref(database, `rooms/${roomId}/playback`);
    const unsubscribe = onValue(playbackRef, (snapshot) => {
      const state = snapshot.val() as PlaybackState;
      if (!state) return;

      latestPlaybackRef.current = state;

      if (typeof state.seq === 'number') {
        lastSeqRef.current = Math.max(lastSeqRef.current, state.seq);
      }

      if (state.status === 'paused' && state.updatedByName) {
        setPausedByName(state.updatedByName);
      }

      if (state.updatedBy === userId) return;

      applyPlaybackToMedia(state, false);
    });

    return () => unsubscribe();
  }, [roomId, videoInfo, playerMode, userId, effectiveDriveToken, ytReady, applyPlaybackToMedia]);

  // Send local HTML5 playback state to Firebase Realtime Database
  const updatePlaybackState = useCallback(
    (
      action: 'play' | 'pause' | 'seek' | 'heartbeat',
      explicitIsPlaying?: boolean,
      explicitCurrentTime?: number
    ) => {
      if (!videoRef.current) return;
      if (isApplyingRemoteRef.current) return;

      if (!canControl) {
        if (latestPlaybackRef.current) {
          applyPlaybackToMedia(latestPlaybackRef.current, true);
        }
        return;
      }

      const isPlaying =
        explicitIsPlaying !== undefined ? explicitIsPlaying : !videoRef.current.paused;
      const currentTime =
        explicitCurrentTime !== undefined ? explicitCurrentTime : videoRef.current.currentTime;
      const duration = videoRef.current.duration || 0;

      sendPlaybackPayload(action, isPlaying, currentTime, duration);
    },
    [canControl, applyPlaybackToMedia, sendPlaybackPayload]
  );

  // 5. Heartbeat (sender) + Continuous Sync Enforcer (receiver)
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerMode === 'iframe' || !videoInfo) return;

      const lastUpdater = latestPlaybackRef.current?.updatedBy;
      const shouldSendHeartbeat = canControl && (isHost || lastUpdater === userId);

      if (shouldSendHeartbeat) {
        if (videoInfo.source === 'youtube') {
          const yt = ytPlayerRef.current;
          if (yt && typeof yt.getPlayerState === 'function' && yt.getPlayerState() === 1) {
            sendPlaybackPayload(
              'heartbeat',
              true,
              yt.getCurrentTime() || 0,
              yt.getDuration() || 0
            );
          }
        } else if (videoRef.current && !videoRef.current.paused && !videoRef.current.seeking) {
          updatePlaybackState('heartbeat', true, videoRef.current.currentTime);
        }
      }

      const remoteState = latestPlaybackRef.current;
      if (remoteState && remoteState.updatedBy !== userId && !isApplyingRemoteRef.current) {
        if (videoInfo.source === 'youtube') {
          applyPlaybackToMedia(remoteState, false);
        } else if (
          videoRef.current &&
          !videoRef.current.seeking &&
          videoRef.current.readyState >= 2
        ) {
          applyPlaybackToMedia(remoteState, false);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [
    roomId,
    playerMode,
    userId,
    videoInfo,
    canControl,
    isHost,
    sendPlaybackPayload,
    updatePlaybackState,
    applyPlaybackToMedia
  ]);

  // Parse shared subtitles into cues
  const subtitleCues = useMemo<SubtitleCue[]>(() => {
    if (!sharedSubtitle?.content) return [];
    return parseSubtitles(sharedSubtitle.content);
  }, [sharedSubtitle?.content]);

  // Find active subtitle cue for current playback time
  const activeSubtitleText = useMemo<string | null>(() => {
    if (!subtitlesEnabled || subtitleCues.length === 0) return null;
    const adjustedTime = localCurrentTime - subtitleOffsetSec;
    const cue = subtitleCues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);
    return cue ? cue.text : null;
  }, [subtitlesEnabled, subtitleCues, localCurrentTime, subtitleOffsetSec]);

  // Build the authenticated Drive stream URL
  const buildDriveStreamUrl = (
    fileId: string,
    token: string,
    size?: number,
    mimeType?: string
  ) => {
    if (swStatus === 'ready' && !useCloudProxyFallback) {
      return getDriveServiceWorkerStreamUrl(fileId, token, size, mimeType);
    }
    return getDriveCloudProxyStreamUrl(DRIVE_STREAM_BASE_URL, fileId, token);
  };

  // Convert videoInfo into streaming and preview links
  const getProcessedUrls = () => {
    if (!videoInfo) return { stream: '', preview: '' };

    if (videoInfo.source === 'drive-oauth') {
      const stream =
        effectiveDriveToken && videoInfo.driveFileId
          ? buildDriveStreamUrl(
              videoInfo.driveFileId,
              effectiveDriveToken,
              videoInfo.size,
              videoInfo.mimeType
            )
          : '';
      return {
        stream,
        preview:
          videoInfo.previewUrl ||
          (videoInfo.driveFileId
            ? `https://drive.google.com/file/d/${videoInfo.driveFileId}/preview`
            : '')
      };
    } else if (videoInfo.source === 'youtube') {
      return {
        stream: '',
        preview: videoInfo.youtubeId
          ? `https://www.youtube.com/embed/${videoInfo.youtubeId}`
          : ''
      };
    } else {
      const url = videoInfo.directUrl || '';
      const fileId = getGoogleDriveId(url);
      if (fileId) {
        const streamUrl = effectiveDriveToken
          ? buildDriveStreamUrl(fileId, effectiveDriveToken)
          : `https://drive.google.com/uc?export=download&id=${fileId}`;
        return {
          stream: streamUrl,
          preview: `https://drive.google.com/file/d/${fileId}/preview`
        };
      }
      return { stream: url, preview: url };
    }
  };

  const processed = getProcessedUrls();

  // HTML5 Video Event Handlers
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setLocalDuration(videoRef.current.duration || 0);
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      videoRef.current.playbackRate = playbackSpeed;
    }
    if (latestPlaybackRef.current) {
      applyPlaybackToMedia(latestPlaybackRef.current, true);
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setLocalCurrentTime(v.currentTime || 0);
    if (v.duration && Number.isFinite(v.duration)) {
      setLocalDuration(v.duration);
      if (v.buffered && v.buffered.length > 0) {
        const end = v.buffered.end(v.buffered.length - 1);
        setBufferedPercent(Math.min(100, (end / v.duration) * 100));
      }
    }
  };

  const handleCanPlay = () => {
    if (latestPlaybackRef.current && latestPlaybackRef.current.updatedBy !== userId) {
      applyPlaybackToMedia(latestPlaybackRef.current, false);
    }
  };

  const handlePlay = () => {
    setLocalIsPlaying(true);
    if (isApplyingRemoteRef.current) return;
    updatePlaybackState('play', true, videoRef.current?.currentTime);
  };

  const handlePause = () => {
    setLocalIsPlaying(false);
    if (!videoRef.current || isApplyingRemoteRef.current) return;
    if (videoRef.current.seeking || videoRef.current.ended) return;
    updatePlaybackState('pause', false, videoRef.current.currentTime);
  };

  const handleSeeked = () => {
    if (!videoRef.current || isApplyingRemoteRef.current) return;
    const isPlaying = !videoRef.current.paused;
    updatePlaybackState('seek', isPlaying, videoRef.current.currentTime);
  };

  // Custom HUD Actions (Play/Pause, Seek, Volume, Mute, Fullscreen, PiP, Subtitles, Quality)
  const handleHudTogglePlay = () => {
    if (!canControl) return;
    if (videoInfo?.source === 'youtube') {
      const yt = ytPlayerRef.current;
      if (!yt) return;
      const state = yt.getPlayerState?.();
      if (state === 1) {
        yt.pauseVideo();
      } else {
        yt.playVideo();
      }
      return;
    }

    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const handleHudSkip = (deltaSec: number) => {
    if (!canControl) return;
    if (videoInfo?.source === 'youtube') {
      const yt = ytPlayerRef.current;
      if (!yt || typeof yt.getCurrentTime !== 'function') return;
      const next = Math.max(0, Math.min(localDuration || 99999, (yt.getCurrentTime() || 0) + deltaSec));
      yt.seekTo(next, true);
      setLocalCurrentTime(next);
      sendPlaybackPayload('seek', localIsPlaying, next, localDuration);
      return;
    }

    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 99999, v.currentTime + deltaSec));
    v.currentTime = next;
    setLocalCurrentTime(next);
    updatePlaybackState('seek', !v.paused, next);
  };

  const handleHudScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canControl) return;
    const nextTime = Number(e.target.value);
    setLocalCurrentTime(nextTime);
    if (videoInfo?.source === 'youtube') {
      ytPlayerRef.current?.seekTo?.(nextTime, true);
      sendPlaybackPayload('seek', localIsPlaying, nextTime, localDuration);
    } else if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      updatePlaybackState('seek', !videoRef.current.paused, nextTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    setVolume(nextVol);
    localStorage.setItem('watchparty_volume', String(nextVol));
    const nextMuted = nextVol === 0;
    setIsMuted(nextMuted);
    if (!nextMuted) setIsAutoplayMuted(false);

    if (videoRef.current) {
      videoRef.current.volume = nextVol;
      videoRef.current.muted = nextMuted;
    }
    if (ytPlayerRef.current?.setVolume) {
      ytPlayerRef.current.setVolume(Math.round(nextVol * 100));
      if (nextMuted) ytPlayerRef.current.mute?.();
      else ytPlayerRef.current.unMute?.();
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) setIsAutoplayMuted(false);

    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
      if (!nextMuted && volume === 0) {
        setVolume(0.8);
        videoRef.current.volume = 0.8;
      }
    }
    if (ytPlayerRef.current) {
      if (nextMuted) ytPlayerRef.current.mute?.();
      else ytPlayerRef.current.unMute?.();
    }
  };

  const handleToggleFullscreen = () => {
    const container = viewportRef.current;
    if (!container) return;

    const fsEl =
      document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (!fsEl) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
        (videoRef.current as any).webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

  const handleTogglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ((videoRef.current as any).requestPictureInPicture) {
        await (videoRef.current as any).requestPictureInPicture();
      }
    } catch {
      // PiP not supported on this device/browser
    }
  };

  const handleSpeedChange = (spd: number) => {
    setPlaybackSpeed(spd);
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
    if (ytPlayerRef.current?.setPlaybackRate) {
      ytPlayerRef.current.setPlaybackRate(spd);
    }
  };

  const handleYtQualityChange = (q: string) => {
    setYtQuality(q);
    if (ytPlayerRef.current?.setPlaybackQuality) {
      ytPlayerRef.current.setPlaybackQuality(q);
    }
  };

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const subData: SharedSubtitleData = {
        name: file.name,
        content: content.slice(0, 580000),
        uploadedBy: nickname || 'Participante',
        updatedAt: Date.now()
      };
      setSharedSubtitle(subData);
      setSubtitlesEnabled(true);
      if (isConfigured && database) {
        set(ref(database, `rooms/${roomId}/subtitle`), subData).catch((err) => {
          console.error('Erro ao compartilhar legenda na sala:', err);
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRemoveSubtitle = () => {
    setSharedSubtitle(null);
    if (isConfigured && database) {
      set(ref(database, `rooms/${roomId}/subtitle`), null).catch(() => {});
    }
  };

  const handleToggleChatOnScreen = () => {
    const next = !showChatOnScreen;
    setShowChatOnScreen(next);
    localStorage.setItem('watchparty_chat_overlay', String(next));
  };

  const handleSendReaction = (emoji: string) => {
    playPopSound();
    const localId = `local-${Date.now()}-${Math.random()}`;
    setFloatingReactions((prev) => [
      ...prev.slice(-10),
      {
        id: localId,
        emoji,
        sender: nickname || 'Você',
        leftPercent: 15 + Math.floor(Math.random() * 70)
      }
    ]);
    window.setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== localId));
    }, 3400);

    if (isConfigured && database) {
      push(ref(database, `rooms/${roomId}/reactions`), {
        emoji,
        sender: nickname || 'Convidado',
        timestamp: Date.now()
      }).catch(() => {});
    }
  };

  const handleToggleReady = () => {
    const next = !isReady;
    setIsReady(next);
    if (next) playChimeSound();
    else playPopSound();

    if (isConfigured && database) {
      set(ref(database, `rooms/${roomId}/lobby/participants/${userId}`), {
        nickname: nickname || 'Convidado',
        ready: next,
        isHost,
        updatedAt: Date.now()
      }).catch(() => {});
    }
  };

  const handleStartCountdown = () => {
    if (!canControl) return;
    const now = getServerNow();
    if (isConfigured && database) {
      set(ref(database, `rooms/${roomId}/lobby/countdown`), {
        startedAt: now,
        startedBy: userId,
        startedByName: nickname || 'Host'
      }).catch(() => {});
    } else {
      playCountdownBeep(3);
      setCountdownStep('3');
      window.setTimeout(() => {
        playCountdownBeep(2);
        setCountdownStep('2');
      }, 1000);
      window.setTimeout(() => {
        playCountdownBeep(1);
        setCountdownStep('1');
      }, 2000);
      window.setTimeout(() => {
        playActionChord();
        setCountdownStep('🍿 AÇÃO!');
        videoRef.current?.play().catch(() => {});
      }, 3000);
      window.setTimeout(() => setCountdownStep(null), 4200);
    }
  };

  // Set room control mode (Host only) with sound
  const handleSetControlMode = (nextMode: 'anyone' | 'host') => {
    if (!isHost || controlMode === nextMode) return;
    playPopSound();
    setControlMode(nextMode);
    if (isConfigured && database) {
      if (!hostId) {
        set(ref(database, `rooms/${roomId}/hostId`), userId).catch(() => {});
      }
      set(ref(database, `rooms/${roomId}/settings`), {
        ...roomSettingsExtra,
        controlMode: nextMode
      }).catch((err) => {
        console.error('Erro ao atualizar modo de controle:', err);
      });
    }
  };



  // Manual resync button for any participant
  const handleManualSync = () => {
    if (latestPlaybackRef.current) {
      applyPlaybackToMedia(latestPlaybackRef.current, true);
    }
  };

  // Unmute handler when browser forced muted autoplay
  const handleUnmuteAutoplay = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);
      setIsAutoplayMuted(false);
      if (videoRef.current.paused && latestPlaybackRef.current?.status === 'playing') {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  // Verify the reason of streaming failures using Google Drive metadata endpoint
  const checkVideoFetchError = async () => {
    const fileId = videoInfo?.driveFileId || getGoogleDriveId(videoInfo?.directUrl || '');
    if (!fileId || !effectiveDriveToken) {
      setVideoError(
        'Conecte sua conta do Google Drive para carregar o reprodutor sincronizado.'
      );
      return;
    }

    if (swStatus === 'ready' && !useCloudProxyFallback) {
      console.warn('[playback] Alternando do Service Worker para o Cloud Proxy chunked...');
      setUseCloudProxyFallback(true);
      return;
    }

    try {
      const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=id,name,mimeType,size&supportsAllDrives=true`;
      const response = await fetch(metaUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${effectiveDriveToken}` }
      });
      if (response.status === 401) {
        setGoogleToken('');
        setVideoError(
          'A sessão do Google Drive expirou (dura 1h). Clique em "Renovar Conexão Google" abaixo para continuar assistindo em sincronia.'
        );
      } else if (response.status === 403 || response.status === 404) {
        setVideoError(
          'Sem permissão para ler este arquivo no Google Drive. Clique em "Renovar Conexão Google" com a conta dona do arquivo ou compartilhe o arquivo como "Qualquer pessoa com o link".'
        );
      } else {
        setVideoError(
          'O navegador não conseguiu decodificar este formato de vídeo diretamente (ex: codec MKV/HEVC ou áudio AC3). Tente um arquivo .mp4 (H.264/AAC) ou clique em "Abrir Modo Preview (Sem Sync)".'
        );
      }
    } catch {
      setVideoError(
        'Falha de rede ao carregar o stream do Google Drive. Clique em "Tentar Novamente".'
      );
    }
  };

  const handleVideoError = () => {
    if (videoInfo?.source === 'drive-oauth' || getGoogleDriveId(videoInfo?.directUrl || '')) {
      checkVideoFetchError();
    } else {
      setVideoError(
        'Não foi possível carregar o vídeo. Verifique se o link está correto ou se o arquivo é público.'
      );
    }
  };

  const publishNewVideo = (videoData: VideoMetadata) => {
    setUseIframeFallback(false);
    setUseCloudProxyFallback(false);
    setVideoError(null);
    setShowAutoplayOverlay(false);
    setIsAutoplayMuted(false);

    if (isConfigured && database) {
      if (!hostId) {
        set(ref(database, `rooms/${roomId}/hostId`), userId);
      }
      set(ref(database, `rooms/${roomId}/video`), videoData);
      set(ref(database, `rooms/${roomId}/videoUrl`), null);

      const nextSeq = lastSeqRef.current + 1;
      lastSeqRef.current = nextSeq;
      const initialPlayback: PlaybackState = {
        status: 'paused',
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        updatedAt: getServerNow(),
        updatedBy: userId,
        updatedByName: nickname || 'Host',
        action: 'pause',
        seq: nextSeq
      };
      latestPlaybackRef.current = initialPlayback;
      set(ref(database, `rooms/${roomId}/playback`), initialPlayback);
    } else {
      if (!hostId) setHostId(userId);
      setVideoInfo(videoData);
    }
  };

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim() || !canControl) return;

    const url = inputUrl.trim();
    const ytId = getYouTubeId(url);
    const driveId = getGoogleDriveId(url);

    let videoData: VideoMetadata;

    if (ytId) {
      videoData = {
        source: 'youtube',
        youtubeId: ytId,
        directUrl: url,
        name: `YouTube (${ytId})`,
        updatedAt: getServerNow(),
        updatedBy: userId
      };
    } else if (driveId) {
      let token = googleToken;
      if (!token && GOOGLE_CLIENT_ID) {
        try {
          await loadGoogleApis();
          token = await requestDriveToken(GOOGLE_CLIENT_ID);
          setGoogleToken(token);
        } catch (err) {
          console.warn('Não foi possível obter token OAuth para o link do Drive:', err);
        }
      }
      videoData = {
        source: 'drive-oauth',
        driveFileId: driveId,
        name: 'Vídeo do Google Drive',
        ...(token ? { accessToken: token } : {}),
        previewUrl: `https://drive.google.com/file/d/${driveId}/preview`,
        updatedAt: getServerNow(),
        updatedBy: userId
      };
    } else {
      videoData = {
        source: 'manual',
        directUrl: url,
        name: 'Vídeo da Web',
        updatedAt: getServerNow(),
        updatedBy: userId
      };
    }

    publishNewVideo(videoData);
    setInputUrl('');
  };

  const handleConnectOnly = async () => {
    if (!GOOGLE_CLIENT_ID) {
      alert('Configuração do Google Client ID ausente.');
      return;
    }
    try {
      await loadGoogleApis();
      const token = await requestDriveToken(GOOGLE_CLIENT_ID);
      setGoogleToken(token);
      setUseIframeFallback(false);
      setUseCloudProxyFallback(false);
      setVideoError(null);

      if (isConfigured && database && videoInfo?.source === 'drive-oauth') {
        const updatedVideo: VideoMetadata = {
          ...videoInfo,
          accessToken: token,
          updatedAt: getServerNow()
        };
        set(ref(database, `rooms/${roomId}/video`), updatedVideo).catch(() => {});
      }
    } catch (err) {
      console.error('Erro ao conectar Google Drive:', err);
      alert('Falha ao autenticar com a conta do Google.');
    }
  };

  const handleGoogleDriveSelect = async () => {
    if (!canControl) return;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY || !GOOGLE_APP_ID) {
      alert(
        'Integração do Google Drive não configurada no servidor. Verifique o arquivo .env.local.'
      );
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
            ...(file.sizeBytes ? { size: file.sizeBytes } : {}),
            accessToken: token,
            previewUrl: file.embedUrl || `https://drive.google.com/file/d/${file.id}/preview`,
            updatedAt: getServerNow(),
            updatedBy: userId
          };
          publishNewVideo(videoData);
        }
      });
    } catch (err) {
      console.error('Erro na integração do Google Drive:', err);
      alert('Erro ao abrir seletor do Google Drive. Detalhes no console dev.');
    }
  };

  const handleRemoveVideo = () => {
    if (!canControl) return;
    if (isConfigured && database) {
      set(ref(database, `rooms/${roomId}/video`), null);
      set(ref(database, `rooms/${roomId}/videoUrl`), null);
      set(ref(database, `rooms/${roomId}/playback`), null);
    } else {
      setVideoInfo(null);
      setUseIframeFallback(false);
      setUseCloudProxyFallback(false);
      setVideoError(null);
      setShowAutoplayOverlay(false);
    }
  };

  const handleEnableAutoplay = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);
      setIsAutoplayMuted(false);
      videoRef.current
        .play()
        .then(() => {
          setShowAutoplayOverlay(false);
          if (latestPlaybackRef.current) {
            applyPlaybackToMedia(latestPlaybackRef.current, true);
          }
        })
        .catch((err) => {
          console.error('Autoplay ainda bloqueado pelo navegador:', err);
        });
    }
  };

  // Deduplicate participants by nickname (preferring current userId or latest updatedAt)
  const participantList = useMemo(() => {
    const byName = new Map<string, [string, LobbyParticipant]>();
    for (const [uid, p] of Object.entries(participants)) {
      const key = (p.nickname || uid).trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, [uid, p]);
      } else {
        const [existUid, existP] = existing;
        if (uid === userId || (existUid !== userId && (p.updatedAt || 0) > (existP.updatedAt || 0))) {
          byName.set(key, [uid, p]);
        }
      }
    }
    return Array.from(byName.values());
  }, [participants, userId]);

  const readyCount = participantList.filter(([, p]) => p.ready).length;
  const remainingTime = Math.max(0, (localDuration || 0) - localCurrentTime);
  const progressPercent =
    localDuration > 0 ? Math.min(100, (localCurrentTime / localDuration) * 100) : 0;

  // Reusable Cinema Lounge & Presence Deck (21st.dev high-craft style)
  const renderPermissionAndLobbyBar = () => (
    <div className="cinema-lounge-deck">
      <div className="lounge-cockpit-top">
        {/* Left: Mode Controller (Segmented pill for host, status pill for guest) */}
        <div className="lounge-mode-cluster">
          {isHost ? (
            <div className="segmented-control-host" role="radiogroup" aria-label="Modo de Controle">
              <button
                type="button"
                onClick={() => handleSetControlMode('anyone')}
                className={`segmented-tab ${controlMode === 'anyone' ? 'active' : ''}`}
                title="Modo Livre: qualquer pessoa na sala pode pausar, dar play e buscar"
              >
                <Users size={12} />
                <span>Controle Livre</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetControlMode('host')}
                className={`segmented-tab ${controlMode === 'host' ? 'active' : ''}`}
                title="Modo Só Host: apenas você comanda a reprodução da sessão"
              >
                <Crown size={12} />
                <span>Só Host</span>
              </button>
            </div>
          ) : (
            <div className="guest-mode-status-pill">
              {controlMode === 'anyone' ? (
                <>
                  <Users size={12} className="glyph-purple" />
                  <span>Controle Livre (Todos)</span>
                </>
              ) : (
                <>
                  <Crown size={12} className="glyph-amber" />
                  <span>Host no Comando</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions (Pipoca Pronta + Countdown) */}
        <div className="lounge-actions-cluster">
          <button
            type="button"
            onClick={handleToggleReady}
            className={`btn-cinema-ready ${isReady ? 'is-ready' : ''}`}
            title="Sinalize para a sala se sua pipoca e refrigerante estão prontos!"
          >
            <span className="ready-glyph">🍿</span>
            <span className="ready-text">{isReady ? 'Pipoca Pronta!' : 'Pegar Pipoca'}</span>
            {isReady && <span className="ready-sparkle">✨</span>}
          </button>

          {canControl && videoInfo && (
            <button
              type="button"
              onClick={handleStartCountdown}
              className="btn-launch-countdown"
              title="Disparar contagem cinematográfica 3, 2, 1 e dar play para todos ao mesmo tempo!"
            >
              <Sparkles size={13} className="sparkle-beacon" />
              <span>3, 2, 1 Play!</span>
            </button>
          )}
        </div>
      </div>

      {/* Online Audience Avatars Cluster */}
      {participantList.length > 0 && (
        <div className="lounge-audience-row">
          <div className="audience-avatars-stack">
            {participantList.map(([uid, p], index) => {
              const isMe = uid === userId;
              const cleanName = (p.nickname || 'Anônimo').replace(/[^a-zA-Z0-9\s]/g, '').trim();
              const words = cleanName.split(/\s+/).filter(Boolean);
              const initials =
                words.length > 1
                  ? (words[0][0] + words[1][0]).toUpperCase()
                  : (cleanName.slice(0, 2) || 'P').toUpperCase();
              const avatarGradients = [
                'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
                'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
                'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
                'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)'
              ];
              const gradient = avatarGradients[index % avatarGradients.length];

              return (
                <div
                  key={uid}
                  className={`audience-avatar-bubble ${p.ready ? 'ready' : ''} ${isMe ? 'is-me' : ''}`}
                  title={`${p.nickname} ${isMe ? '(Você)' : ''} • ${p.ready ? '🍿 Pipoca Pronta!' : 'Aguardando'}`}
                >
                  <div className="avatar-disc" style={{ background: gradient }}>
                    <span>{initials}</span>
                  </div>
                  {p.ready && (
                    <span className="avatar-popcorn-tag" aria-label="Pipoca pronta">🍿</span>
                  )}
                  <span className={`avatar-status-beacon ${p.ready ? 'ready' : 'idle'}`} />
                </div>
              );
            })}
          </div>

          <div className="audience-summary-meta">
            <span className="summary-status-dot" />
            <span className="summary-count-label">
              <strong>{participantList.length}</strong> {participantList.length === 1 ? 'na sala' : 'na sala'}
            </span>
            <span className="summary-sep">•</span>
            <span className="summary-ready-label">
              {readyCount === 0
                ? 'Ninguém pronto ainda'
                : readyCount === participantList.length
                ? 'Todos com a pipoca pronta! 🍿'
                : `${readyCount}/${participantList.length} pronto(s)`}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  // 1. Studio Media Dock (No video loaded)
  if (!videoInfo) {
    return (
      <div className="player-container-stack">
        {renderPermissionAndLobbyBar()}

        <div className="cinema-media-dock animate-fade-in">
          {/* Top Console Bar */}
          <div className="dock-console-top">
            <div className="dock-console-status">
              <span className="dock-beacon-led" />
              <span className="dock-console-title">PROJETOR DE CINEMA • SELECIONE A TRANSMISSÃO</span>
            </div>
            <div className="dock-latency-badge">
              <Sparkles size={11} />
              <span>Sincronização em Tempo Real (Δ &lt; 15ms)</span>
            </div>
          </div>

          <div className="dock-main-body">
            {canControl ? (
              <>
                <div className="dock-cards-grid">
                  {/* Option 1: Google Drive Card */}
                  <div className="dock-source-card drive-card">
                    <div className="source-card-badge">RECOMENDADO</div>
                    <div className="source-card-icon-box drive">
                      <FolderOpen size={24} />
                    </div>
                    <div className="source-card-text">
                      <h3>Google Drive</h3>
                      <p>
                        Transmita qualquer filme ou série do seu Drive em qualidade original, sem compressão e com play/pause 100% sincronizado.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleGoogleDriveSelect}
                      className="btn-dock-action drive"
                    >
                      <FolderOpen size={16} />
                      <span>Escolher do Google Drive</span>
                    </button>
                  </div>

                  {/* Option 2: YouTube / Web Video Card */}
                  <div className="dock-source-card url-card">
                    <div className="source-card-badge alt">LINK EXTERNO</div>
                    <div className="source-card-icon-box web">
                      <Video size={24} />
                    </div>
                    <div className="source-card-text">
                      <h3>YouTube ou Link Web</h3>
                      <p>
                        Cole links de vídeos do YouTube ou qualquer link direto <code>.mp4</code> para assistir junto com a sala.
                      </p>
                    </div>
                    <form onSubmit={handleAddVideo} className="dock-url-form">
                      <div className="dock-input-wrapper">
                        <Link2 size={14} className="dock-input-glyph" />
                        <input
                          type="text"
                          className="dock-url-input"
                          placeholder="Cole link do YouTube ou .mp4..."
                          value={inputUrl}
                          onChange={(e) => setInputUrl(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (text) {
                                playPopSound();
                                setInputUrl(text.trim());
                              }
                            } catch {
                              // ignore
                            }
                          }}
                          className="btn-dock-paste"
                          title="Colar link da área de transferência"
                        >
                          <ClipboardCopy size={12} />
                          <span>Colar</span>
                        </button>
                      </div>
                      {inputUrl.trim() && (
                        <div className="dock-detected-badge animate-fade-in">
                          {getYouTubeId(inputUrl) ? (
                            <span>🎥 YouTube detectado • Player IFrame Sincronizado</span>
                          ) : getGoogleDriveId(inputUrl) ? (
                            <span>☁️ Google Drive detectado • Stream de Alta Fidelidade</span>
                          ) : (
                            <span>⚡ Arquivo de Vídeo Web Direto (.mp4 / stream)</span>
                          )}
                        </div>
                      )}
                      <button type="submit" className="btn-dock-action url">
                        <span>Carregar Vídeo</span>
                        <ArrowRight size={15} />
                      </button>
                    </form>
                  </div>
                </div>

                {/* Bottom Cinema Features Ribbon */}
                <div className="dock-features-ribbon">
                  <span className="ribbon-chip">
                    <CheckCircle2 size={12} /> Play & Pause Sincronizados
                  </span>
                  <span className="ribbon-chip">
                    <Subtitles size={12} /> Legendas .SRT Compartilhadas
                  </span>
                  <span className="ribbon-chip">
                    <Volume2 size={12} /> Volume Individual
                  </span>
                  <span className="ribbon-chip">
                    <MessageSquare size={12} /> Chat na Tela
                  </span>
                </div>
              </>
            ) : (
              <div className="dock-guest-waiting">
                <div className="waiting-spinner-beacon">
                  <span className="spinner-halo" />
                  <Video size={30} className="waiting-icon" />
                </div>
                <h3>Cabine de Transmissão Pronta</h3>
                <p>
                  O anfitrião da sala está selecionando o filme para iniciar a exibição sincronizada. Prepare a pipoca!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Drive OAuth block ONLY if neither the room nor the local user has a Drive token
  if (videoInfo.source === 'drive-oauth' && !effectiveDriveToken) {
    return (
      <div className="player-container-stack">
        {renderPermissionAndLobbyBar()}
        <div className="player-empty-state glass animate-fade-in">
          <div className="empty-content">
            <div className="link-icon-container">
              <Info size={32} className="purple-glow-icon" />
            </div>
            <h2>Vídeo do Google Drive Selecionado</h2>
            <p>
              O arquivo <strong>"{videoInfo.name}"</strong> está carregado nesta party.
            </p>
            <p className="sub-note">
              Conecte o Google Drive para liberar o streaming sincronizado para toda a sala.
            </p>

            <button
              onClick={handleConnectOnly}
              className="btn btn-primary w-full connect-drive-btn"
            >
              🔑 Conectar Google Drive e Sincronizar Sala
            </button>

            {canControl && (
              <button
                onClick={handleRemoveVideo}
                className="btn-change-video"
                style={{ marginTop: '8px' }}
              >
                Trocar Vídeo
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. Playback View (YouTube API, HTML5 video element, or iframe fallback)
  return (
    <div className="player-container-stack">
      {renderPermissionAndLobbyBar()}

      {/* Hidden file input for .srt / .vtt subtitles */}
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".srt,.vtt"
        style={{ display: 'none' }}
        onChange={handleSubtitleUpload}
      />

      <div className="player-wrapper glass">
        {/* Video Title Bar */}
        <div className="player-header">
          <div className="video-title-info">
            {videoInfo.source === 'youtube' ? (
              <Video size={16} className="brand-color-icon" />
            ) : (
              <Play size={15} className="brand-color-icon" />
            )}
            <span
              className="video-title"
              title={
                videoInfo.source === 'drive-oauth'
                  ? `Drive: ${videoInfo.name}`
                  : videoInfo.name || 'Vídeo Compartilhado'
              }
            >
              {videoInfo.source === 'drive-oauth'
                ? `Drive: ${videoInfo.name}`
                : videoInfo.name || 'Vídeo Compartilhado'}
            </span>
          </div>
          <div className="player-header-actions">
            <button
              type="button"
              onClick={() => subtitleInputRef.current?.click()}
              className="btn-resync"
              title="Enviar arquivo de legenda (.srt ou .vtt) sincronizado para todos na sala"
            >
              <Upload size={13} />
              <span>{sharedSubtitle ? 'Legenda Ativa' : 'Legenda .SRT'}</span>
            </button>
            {playerMode !== 'iframe' && (
              <button
                onClick={handleManualSync}
                className="btn-resync"
                title="Sincronizar meu vídeo com a sala agora"
              >
                <RefreshCw size={13} />
                <span>Sincronizar</span>
              </button>
            )}
            {canControl && (
              <button onClick={handleRemoveVideo} className="btn-change-video">
                Trocar Vídeo
              </button>
            )}
          </div>
        </div>

        {/* Cinema Ambilight Aura Effect */}
        <div
          className={`cinema-ambilight-aura ${localIsPlaying ? 'is-playing' : 'is-idle'}`}
          aria-hidden="true"
        />

        {theaterLightsOff && (
          <button
            type="button"
            onClick={() => setTheaterLightsOff(false)}
            className="theater-lights-banner animate-fade-in"
            title="Clique para acender as luzes da sala"
          >
            <Lightbulb size={13} className="banner-glow-icon" />
            <span>Modo Cinema Ativo • Toque para acender as luzes</span>
          </button>
        )}

        {/* Main viewport (Fullscreen target so custom HUD, subtitles, reactions & chat appear in Fullscreen!) */}
        <div
          ref={viewportRef}
          className={`video-viewport filter-${videoFilter} ${isFullscreen ? 'is-fullscreen' : ''}`}
          onMouseMove={pokeHud}
          onTouchStart={pokeHud}
          onClick={pokeHud}
        >
          {/* Countdown 3, 2, 1 Overlay */}
          {countdownStep && (
            <div className="countdown-cinema-overlay">
              <div className="countdown-number">{countdownStep}</div>
              <p>Prepare a pipoca! Sessão sincronizada iniciando...</p>
            </div>
          )}

          {/* Floating Live Reactions Overlay */}
          <div className="floating-reactions-layer">
            {floatingReactions.map((r) => (
              <div
                key={r.id}
                className="floating-reaction-bubble"
                style={{ left: `${r.leftPercent}%` }}
              >
                <span className="reaction-emoji">{r.emoji}</span>
                <span className="reaction-sender">{r.sender}</span>
              </div>
            ))}
          </div>

          {/* Synchronized Subtitle Overlay (works in Fullscreen on PC & Mobile!) */}
          {activeSubtitleText && (
            <div className={`custom-subtitle-overlay size-${subtitleSize}`}>
              <span className="subtitle-box">{activeSubtitleText}</span>
            </div>
          )}

          {/* Bottom Chat Notification Overlay (when someone sends a message during fullscreen/video!) */}
          {showChatOnScreen && screenChatToasts.length > 0 && (
            <div className="screen-chat-toast-stack">
              {screenChatToasts.map((t) => (
                <div key={t.id} className="screen-chat-toast">
                  <div className="screen-chat-content">
                    <span className="screen-chat-sender">💬 {t.sender}:</span>
                    <span className="screen-chat-text">{t.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleChatOnScreen();
                    }}
                    className="btn-mute-screen-chat"
                    title="Desativar notificações do chat na tela do vídeo"
                  >
                    <MessageSquareOff size={12} />
                    <span>Ocultar</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {videoError ? (
            <div className="video-error-state">
              <AlertCircle size={40} className="error-icon" />
              <p>{videoError}</p>
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  justifyContent: 'center'
                }}
              >
                {videoInfo.source === 'drive-oauth' && (
                  <button onClick={handleConnectOnly} className="btn btn-primary btn-sm">
                    🔑 Renovar Conexão Google
                  </button>
                )}
                <button
                  onClick={() => {
                    setVideoError(null);
                    setUseCloudProxyFallback(false);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Tentar Novamente
                </button>
                {videoInfo.source === 'drive-oauth' && (
                  <button
                    onClick={() => {
                      setVideoError(null);
                      setUseIframeFallback(true);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Abrir Modo Preview (Sem Sync)
                  </button>
                )}
              </div>
            </div>
          ) : videoInfo.source === 'drive-oauth' && swStatus === 'checking' ? (
            <div className="video-error-state">
              <p>Preparando reprodutor sincronizado...</p>
            </div>
          ) : playerMode === 'youtube' ? (
            /* YouTube IFrame API Sync Player */
            <div className="video-element-container">
              <div ref={ytContainerRef} className="youtube-player-mount" />
              {!canControl && (
                <div
                  className="viewer-lock-overlay"
                  title="Apenas o Host pode pausar ou avançar o vídeo neste modo"
                />
              )}
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
                <div className="iframe-banner-content">
                  <span>
                    <strong>Modo Iframe do Google Drive:</strong> O navegador impede o controle
                    automático de Play/Pause dentro do player embutido do Drive.
                  </span>
                  {GOOGLE_CLIENT_ID && (
                    <button onClick={handleConnectOnly} className="btn-inline-connect">
                      🔑 Voltar para o Player Sincronizado
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Standard HTML5 Sync Player */
            <div className="video-element-container">
              {isAutoplayMuted && (
                <button
                  type="button"
                  onClick={handleUnmuteAutoplay}
                  className="unmute-floating-banner"
                >
                  <VolumeX size={16} />
                  <span>
                    Áudio bloqueado pelo navegador. <strong>Toque para ativar o som!</strong>
                  </span>
                </button>
              )}

              {/* Top-Left Non-Overlapping Paused Indicator for ALL participants */}
              {!localIsPlaying && !showAutoplayOverlay && (
                <div
                  className="paused-status-pill"
                  onClick={canControl ? handleHudTogglePlay : undefined}
                  style={{ cursor: canControl ? 'pointer' : 'default' }}
                >
                  <Pause size={13} className="paused-icon" />
                  <span className="paused-text">
                    {pausedByName ? `Pausado por ${pausedByName}` : 'Filme em Pausa'}
                    {canControl ? ' • Toque para Play' : ' • Aguardando Host'}
                  </span>
                </div>
              )}

              <video
                ref={videoRef}
                src={processed.stream}
                controls={false}
                playsInline
                onClick={canControl ? handleHudTogglePlay : pokeHud}
                onDoubleClick={handleToggleFullscreen}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onCanPlay={handleCanPlay}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeeked={handleSeeked}
                onError={handleVideoError}
                className="video-element"
              />

              {showAutoplayOverlay && (
                <div className="autoplay-overlay glass">
                  <p>
                    O vídeo foi iniciado na sala! Clique abaixo para liberar o áudio e assistir
                    em sincronia.
                  </p>
                  <button onClick={handleEnableAutoplay} className="btn btn-primary btn-sm">
                    ▶️ Ativar Reprodução Sincronizada
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Custom Cinema Control Bar (HUD) - Visible for BOTH Host and Guests! */}
          {playerMode !== 'iframe' && !videoError && (
            <div
              className={`custom-cinema-hud ${hudVisible || !localIsPlaying ? 'visible' : 'hidden'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Tier 1: Time Elapsed / Total + Progress Bar + Time Remaining */}
              <div className="hud-timeline-group">
                <div className="hud-time-meta-row">
                  <div className="hud-time-left">
                    <span className="time-current">{formatDuration(localCurrentTime)}</span>
                    <span className="time-sep">/</span>
                    <span className="time-total">{formatDuration(localDuration)}</span>
                  </div>
                  {localDuration > 0 && (
                    <span
                      className="time-remaining-pill"
                      title="Tempo que falta para terminar o filme"
                    >
                      Faltam {formatDuration(remainingTime, true)}
                    </span>
                  )}
                </div>

                <div className="hud-progress-track">
                  <div
                    className="hud-progress-buffered"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div
                    className="hud-progress-filled"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={localDuration > 0 ? localDuration : 100}
                    step={0.5}
                    value={localCurrentTime}
                    disabled={!canControl}
                    onChange={handleHudScrub}
                    className={`hud-progress-slider ${!canControl ? 'readonly' : ''}`}
                    title={
                      canControl
                        ? 'Arraste para avançar ou voltar o filme para todos'
                        : 'Progresso sincronizado com o Host'
                    }
                  />
                </div>
              </div>

              {/* Tier 2: Single-Row Controls (Play/Skip/Volume on Left | Chat/CC/Gear/PiP/Fullscreen on Right) */}
              <div className="hud-controls-row">
                <div className="hud-left-group">
                  {canControl ? (
                    <>
                      <button
                        type="button"
                        onClick={handleHudTogglePlay}
                        className="hud-icon-btn primary-play"
                        title={localIsPlaying ? 'Pausar para todos' : 'Dar Play para todos'}
                      >
                        {localIsPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHudSkip(-10)}
                        className="hud-icon-btn"
                        title="Voltar 10 segundos"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHudSkip(10)}
                        className="hud-icon-btn"
                        title="Avançar 10 segundos"
                      >
                        <RotateCw size={14} />
                      </button>
                    </>
                  ) : (
                    <span
                      className="hud-guest-status-badge"
                      title="O Host está no controle do Play/Pause"
                    >
                      <Lock size={12} />
                      <span>{localIsPlaying ? 'Tocando' : 'Pausado'}</span>
                    </span>
                  )}

                  {/* Local Volume & Mute (Available to EVERYONE including non-host!) */}
                  <div className="hud-volume-group">
                    <button
                      type="button"
                      onClick={handleToggleMute}
                      className="hud-icon-btn"
                      title={isMuted ? 'Ativar som' : 'Mutar meu som'}
                    >
                      {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="hud-volume-slider"
                      title={`Meu Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                    />
                  </div>
                </div>

                {/* Right Side: Chat Overlay Toggle, Subtitles, Settings/Quality, PiP, Fullscreen */}
                <div className="hud-right-group">
                  <button
                    type="button"
                    onClick={handleToggleChatOnScreen}
                    className={`hud-icon-btn ${showChatOnScreen ? 'active-feature' : ''}`}
                    title={
                      showChatOnScreen
                        ? 'Chat na tela ativado (aparece embaixo em Tela Cheia). Clique para desativar.'
                        : 'Chat na tela desativado. Clique para mostrar mensagens em Tela Cheia.'
                    }
                  >
                    {showChatOnScreen ? (
                      <MessageSquare size={15} />
                    ) : (
                      <MessageSquareOff size={15} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!sharedSubtitle) {
                        subtitleInputRef.current?.click();
                      } else {
                        setSubtitlesEnabled((prev) => !prev);
                      }
                    }}
                    className={`hud-icon-btn ${
                      sharedSubtitle && subtitlesEnabled ? 'active-feature' : ''
                    }`}
                    title={
                      sharedSubtitle
                        ? subtitlesEnabled
                          ? 'Ocultar legenda'
                          : 'Mostrar legenda'
                        : 'Carregar arquivo de legenda (.srt / .vtt)'
                    }
                  >
                    <Subtitles size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setTheaterLightsOff((prev) => !prev);
                    }}
                    className={`hud-icon-btn ${theaterLightsOff ? 'active-feature' : ''}`}
                    title={
                      theaterLightsOff
                        ? 'Acender luzes da sala (sair do Modo Cinema)'
                        : 'Apagar luzes da sala (Modo Cinema Imersivo)'
                    }
                  >
                    <Lightbulb size={16} />
                  </button>

                  <div className="hud-settings-wrapper">
                    <button
                      type="button"
                      onClick={() => setShowSettingsMenu((prev) => !prev)}
                      className={`hud-icon-btn ${showSettingsMenu ? 'active-feature' : ''}`}
                      title="Configurações de Qualidade da Transmissão, Legendas e Filtros"
                    >
                      <Settings size={16} />
                    </button>

                    {showSettingsMenu && (
                      <div className="hud-settings-popover glass">
                        <div className="settings-section">
                          <span className="settings-label">📡 Qualidade / Transmissão</span>
                          {videoInfo.source === 'youtube' ? (
                            <div className="settings-options-row">
                              {[
                                { id: 'hd1080', label: '1080p HD' },
                                { id: 'hd720', label: '720p' },
                                { id: 'large', label: '480p' },
                                { id: 'default', label: 'Auto' }
                              ].map((q) => (
                                <button
                                  key={q.id}
                                  type="button"
                                  onClick={() => handleYtQualityChange(q.id)}
                                  className={`settings-chip ${ytQuality === q.id ? 'active' : ''}`}
                                >
                                  {q.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="settings-options-col">
                              <button
                                type="button"
                                onClick={() => setUseCloudProxyFallback(false)}
                                className={`settings-chip ${
                                  !useCloudProxyFallback ? 'active' : ''
                                }`}
                              >
                                ⚡ Original Máxima HD (Direto $0)
                              </button>
                              <button
                                type="button"
                                onClick={() => setUseCloudProxyFallback(true)}
                                className={`settings-chip ${
                                  useCloudProxyFallback ? 'active' : ''
                                }`}
                              >
                                ☁️ Modo Estabilidade (Cloud Proxy)
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="settings-section">
                          <span className="settings-label">🎨 Realce Visual de Cinema</span>
                          <div className="settings-options-row">
                            {[
                              { id: 'none', label: 'Original' },
                              { id: 'cinema', label: 'Cinema HDR' },
                              { id: 'sharp', label: 'Nitidez+' },
                              { id: 'night', label: 'Noturno' }
                            ].map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setVideoFilter(f.id as any)}
                                className={`settings-chip ${videoFilter === f.id ? 'active' : ''}`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="settings-section">
                          <span className="settings-label">⏩ Velocidade</span>
                          <div className="settings-options-row">
                            {[0.75, 1, 1.25, 1.5].map((spd) => (
                              <button
                                key={spd}
                                type="button"
                                onClick={() => handleSpeedChange(spd)}
                                className={`settings-chip ${playbackSpeed === spd ? 'active' : ''}`}
                              >
                                {spd}x
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="settings-section">
                          <span className="settings-label">📝 Legendas (.SRT / .VTT)</span>
                          <div className="settings-options-row">
                            <button
                              type="button"
                              onClick={() => subtitleInputRef.current?.click()}
                              className="settings-chip"
                            >
                              📂 Subir .SRT
                            </button>
                            {sharedSubtitle && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setSubtitlesEnabled((p) => !p)}
                                  className={`settings-chip ${subtitlesEnabled ? 'active' : ''}`}
                                >
                                  {subtitlesEnabled ? 'Ativa ✅' : 'Oculta'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleRemoveSubtitle}
                                  className="settings-chip"
                                >
                                  🗑️ Remover
                                </button>
                              </>
                            )}
                          </div>
                          {sharedSubtitle && (
                            <div className="settings-options-row" style={{ marginTop: '6px' }}>
                              {(['sm', 'md', 'lg'] as const).map((sz) => (
                                <button
                                  key={sz}
                                  type="button"
                                  onClick={() => setSubtitleSize(sz)}
                                  className={`settings-chip ${subtitleSize === sz ? 'active' : ''}`}
                                >
                                  Fonte {sz.toUpperCase()}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  setSubtitleOffsetSec((s) => Number((s - 0.5).toFixed(1)))
                                }
                                className="settings-chip"
                              >
                                -0.5s
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setSubtitleOffsetSec((s) => Number((s + 0.5).toFixed(1)))
                                }
                                className="settings-chip"
                              >
                                +0.5s
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="settings-section">
                          <span className="settings-label">💬 Chat na Parte de Baixo</span>
                          <button
                            type="button"
                            onClick={handleToggleChatOnScreen}
                            className={`settings-chip w-full ${showChatOnScreen ? 'active' : ''}`}
                          >
                            {showChatOnScreen
                              ? '✅ Mostrar mensagens na tela'
                              : '🔕 Não mostrar mensagens na tela'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {playerMode !== 'youtube' && (
                    <button
                      type="button"
                      onClick={handleTogglePiP}
                      className="hud-icon-btn hide-xs"
                      title="Mini-player flutuante (Picture-in-Picture)"
                    >
                      <PictureInPicture2 size={15} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="hud-icon-btn"
                    title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia (com legendas e chat)'}
                  >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sync Status + Live Emoji Reactions Bar Footer */}
        <div className="player-sync-footer">
          <div className="footer-left-status">
            <span className={`sync-badge ${playerMode === 'iframe' ? 'orange' : 'green'}`}>
              <span className="pulse-dot"></span>
              {playerMode === 'drive-proxy-html5'
                ? 'Google Drive Sincronizado'
                : playerMode === 'youtube'
                ? 'YouTube Sincronizado'
                : playerMode === 'iframe'
                ? 'Modo Preview Iframe'
                : 'Player Web Sincronizado'}
            </span>
            <span className="sync-note">
              {canControl
                ? 'Play, Pause e barra de tempo sincronizados para todos.'
                : 'Sincronia automática ativa • Volume, Tela Cheia e Qualidade liberados.'}
            </span>
          </div>

          <div className="footer-right-actions">
            <button
              type="button"
              onClick={() => {
                const next = !soundActive;
                setSoundActive(next);
                setSoundEnabled(next);
                if (next) playPopSound();
              }}
              className={`btn-sound-toggle ${soundActive ? 'active' : ''}`}
              title={
                soundActive
                  ? 'Efeitos sonoros ativados (pipoca, reações e contagem). Clique para silenciar.'
                  : 'Efeitos sonoros desativados. Clique para ativar.'
              }
            >
              {soundActive ? <Volume2 size={13} /> : <VolumeX size={13} />}
              <span>{soundActive ? 'Sons ON' : 'Sons OFF'}</span>
            </button>

            <div className="reaction-bar">
              <span className="reaction-bar-label">Reagir:</span>
              <div className="reaction-buttons-group">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSendReaction(emoji)}
                    className="btn-emoji-react"
                    title={`Enviar ${emoji} na tela de todos`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
