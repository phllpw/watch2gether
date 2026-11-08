export interface RecentRoomItem {
  roomId: string;
  roomTitle?: string;
  lastVisitedAt: number;
  hasPin?: boolean;
}

const RECENT_ROOMS_KEY = 'watchparty_recent_rooms_v1';

export function getRecentRooms(): RecentRoomItem[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 6);
  } catch {
    return [];
  }
}

export function saveRecentRoom(item: RecentRoomItem): void {
  try {
    const existing = getRecentRooms().filter((r) => r.roomId !== item.roomId);
    const updated = [item, ...existing].slice(0, 6);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}

export function removeRecentRoom(roomId: string): RecentRoomItem[] {
  try {
    const updated = getRecentRooms().filter((r) => r.roomId !== roomId);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function buildShareMessage(roomId: string, roomTitle?: string, pin?: string): {
  url: string;
  text: string;
} {
  const url = `${window.location.origin}/room/${roomId}`;
  const titlePart = roomTitle ? ` "${roomTitle}"` : '';
  const pinPart = pin ? `\n🔒 Senha / PIN: ${pin}` : '';
  const text = `🍿 Vem assistir comigo no DuoCine${titlePart}!\n🎬 Código da Sala: ${roomId}${pinPart}\n👉 Entre pelo link: ${url}`;
  return { url, text };
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareViaNative(
  roomId: string,
  roomTitle?: string,
  pin?: string
): Promise<boolean> {
  if (!canNativeShare()) return false;
  const { url, text } = buildShareMessage(roomId, roomTitle, pin);
  try {
    await navigator.share({
      title: roomTitle ? `DuoCine: ${roomTitle}` : `DuoCine - Sala ${roomId}`,
      text,
      url
    });
    return true;
  } catch {
    return false;
  }
}

export function shareToWhatsApp(roomId: string, roomTitle?: string, pin?: string): void {
  const { text } = buildShareMessage(roomId, roomTitle, pin);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

export async function shareToInstagramOrNative(
  roomId: string,
  roomTitle?: string,
  pin?: string
): Promise<'shared' | 'copied'> {
  const { url, text } = buildShareMessage(roomId, roomTitle, pin);

  // Copy to clipboard first so user always has it ready to paste in Instagram Direct
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore clipboard error
  }

  // On mobile browsers (Android / iOS), navigator.share opens the native share sheet (which includes Instagram Direct & Stories)
  if (canNativeShare()) {
    try {
      await navigator.share({
        title: roomTitle ? `DuoCine: ${roomTitle}` : `DuoCine - Sala ${roomId}`,
        text,
        url
      });
      return 'shared';
    } catch {
      // User cancelled or browser blocked share; fallback to Instagram Direct web
    }
  }

  window.open('https://www.instagram.com/direct/inbox/', '_blank', 'noopener,noreferrer');
  return 'copied';
}

