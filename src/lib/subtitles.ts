export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function parseTimecode(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return 0;
}

/**
 * Parses SRT or WebVTT content into an array of SubtitleCue objects.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  if (!content) return [];
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();

  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    // Find the line containing "-->"
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const timeLine = lines[arrowIdx];
    const [startRaw, endWithSettings] = timeLine.split('-->');
    if (!startRaw || !endWithSettings) continue;

    const endRaw = endWithSettings.trim().split(/\s+/)[0];
    const start = parseTimecode(startRaw);
    const end = parseTimecode(endRaw);

    const textLines = lines
      .slice(arrowIdx + 1)
      .map((line) => line.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim())
      .filter(Boolean);

    if (textLines.length > 0 && end >= start) {
      cues.push({
        start,
        end,
        text: textLines.join('\n')
      });
    }
  }

  return cues;
}

/**
 * Formats seconds into HH:MM:SS or MM:SS
 */
export function formatDuration(seconds: number, showRemainingSign = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return showRemainingSign ? '-00:00' : '00:00';
  }
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  const prefix = showRemainingSign ? '-' : '';

  if (hrs > 0) {
    return `${prefix}${String(hrs).padStart(2, '0')}:${paddedMins}:${paddedSecs}`;
  }
  return `${prefix}${paddedMins}:${paddedSecs}`;
}
