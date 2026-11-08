// Service Worker to stream Google Drive videos directly into HTML5 <video>
// Attaches Authorization: Bearer <token> and synthesizes CORS-hidden Content-Range headers
// Cost: $0.00 (streams directly from googleapis.com to the user's browser)

const META_CACHE = new Map();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/__drive_sw_ping__') {
    event.respondWith(
      new Response('sw-ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      })
    );
    return;
  }

  if (url.pathname.startsWith('/__drive_stream__/')) {
    event.respondWith(handleDriveStream(event.request, url));
  }
});

async function getFileMeta(fileId, token, sizeParam, mimeParam) {
  if (sizeParam && Number(sizeParam) > 0) {
    const meta = {
      totalSize: Number(sizeParam),
      mimeType: mimeParam || 'video/mp4'
    };
    META_CACHE.set(fileId, meta);
    return { ok: true, meta };
  }

  const cached = META_CACHE.get(fileId);
  if (cached) {
    return { ok: true, meta: cached };
  }

  const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,mimeType,name&supportsAllDrives=true`;
  const metaRes = await fetch(metaUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    return { ok: false, status: metaRes.status, errText };
  }

  const data = await metaRes.json();
  const totalSize = Number(data.size);
  if (!totalSize || isNaN(totalSize)) {
    return {
      ok: false,
      status: 500,
      errText: JSON.stringify({ error: 'Invalid file size from Google Drive API' })
    };
  }

  const meta = {
    totalSize,
    mimeType: data.mimeType || 'video/mp4'
  };
  META_CACHE.set(fileId, meta);
  return { ok: true, meta };
}

async function handleDriveStream(request, url) {
  const fileId = url.pathname.replace('/__drive_stream__/', '').trim();
  const token = url.searchParams.get('token') || '';
  const sizeParam = url.searchParams.get('size');
  const mimeParam = url.searchParams.get('mime');

  if (!fileId || !token) {
    return new Response('Missing fileId or token', { status: 400 });
  }

  try {
    const metaResult = await getFileMeta(fileId, token, sizeParam, mimeParam);
    if (!metaResult.ok) {
      return new Response(metaResult.errText || 'Metadata error', {
        status: metaResult.status || 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const { totalSize, mimeType } = metaResult.meta;
    const rangeHeader = request.headers.get('Range');

    let start = 0;
    let end = totalSize - 1;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        start = parseInt(match[1], 10);
        if (match[2]) {
          end = Math.min(parseInt(match[2], 10), totalSize - 1);
        }
      }
    }

    if (start >= totalSize || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`
        }
      });
    }

    const contentLength = end - start + 1;
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&acknowledgeAbuse=true&supportsAllDrives=true`;

    const driveRes = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${end}`
      },
      signal: request.signal
    });

    if (!driveRes.ok && driveRes.status !== 206) {
      if (driveRes.status === 401 || driveRes.status === 403) {
        META_CACHE.delete(fileId);
      }
      const errBody = await driveRes.text();
      return new Response(errBody, {
        status: driveRes.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    return new Response(driveRes.body, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(contentLength),
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return new Response(String(err), { status: 500 });
  }
}
