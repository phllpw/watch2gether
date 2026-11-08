import { onRequest } from "firebase-functions/v2/https";
import * as https from "https";

/**
 * Cloud Function driveStream
 * Fallback proxy for Google Drive API media streams (files.get with alt=media)
 * when browser Service Workers are unavailable.
 * Caps each HTTP 206 Range response to 16 MiB so it never exceeds Cloud Run's 32 MiB limit.
 */
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "https://duocine.web.app",
  "https://duocine.firebaseapp.com",
  "https://watch2gether-9b6dd.web.app",
  "https://watch2gether-9b6dd.firebaseapp.com"
];

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024; // 16 MiB (safely under Cloud Run's 32 MiB response limit)

export const driveStream = onRequest({
  cors: true,
  timeoutSeconds: 540,
  memory: "512MiB"
}, (req, res) => {
  const method = req.method;
  const origin = req.headers.origin as string | undefined;
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "*";

  if (method !== 'GET' && method !== 'OPTIONS') {
    res.writeHead(405, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': allowOrigin
    });
    res.end("Método Não Permitido. Use GET ou OPTIONS.");
    return;
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
      'Access-Control-Max-Age': '3600'
    });
    res.end();
    return;
  }

  const fileId = req.query.fileId as string;
  const accessToken = req.query.accessToken as string;

  if (!fileId || !accessToken || !FILE_ID_PATTERN.test(fileId)) {
    res.writeHead(400, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': allowOrigin
    });
    res.end("Erro: Parâmetros fileId ou accessToken ausentes ou inválidos na query string.");
    return;
  }

  console.log(`[driveStream] Iniciando proxy de mídia (chunked) para o arquivo: ${fileId}`);

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true&supportsAllDrives=true`;
  const driveHeaders: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`
  };

  // Clamp open-ended or large Range headers to MAX_CHUNK_BYTES (16 MiB)
  // so Cloud Run never terminates the response with "Response size was too large"
  const rangeHeader = req.headers.range as string | undefined;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : start + MAX_CHUNK_BYTES - 1;
      const end = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1);
      driveHeaders['Range'] = `bytes=${start}-${end}`;
    } else {
      driveHeaders['Range'] = rangeHeader;
    }
  } else {
    driveHeaders['Range'] = `bytes=0-${MAX_CHUNK_BYTES - 1}`;
  }

  const driveReq = https.request(driveUrl, {
    method: 'GET',
    headers: driveHeaders
  }, (driveRes) => {
    const statusCode = driveRes.statusCode || 200;

    if (statusCode >= 400) {
      console.error(`[driveStream] Erro retornado pela Google Drive API: ${statusCode}`);
      let body = '';
      driveRes.on('data', chunk => body += chunk);
      driveRes.on('end', () => {
        if (!res.writableEnded && !res.headersSent) {
          res.writeHead(statusCode, { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': allowOrigin
          });
          res.end(body || JSON.stringify({ error: { message: "Erro ao acessar API do Google Drive", code: statusCode } }));
        }
      });
      return;
    }

    const resHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Accept-Ranges': 'bytes'
    };

    if (driveRes.headers['content-type']) {
      resHeaders['Content-Type'] = driveRes.headers['content-type'] as string;
    }
    if (driveRes.headers['content-length']) {
      resHeaders['Content-Length'] = driveRes.headers['content-length'] as string;
    }
    if (driveRes.headers['content-range']) {
      resHeaders['Content-Range'] = driveRes.headers['content-range'] as string;
    }

    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(statusCode, resHeaders);
      driveRes.pipe(res);
    }
  });

  driveReq.on('error', (err) => {
    console.error("[driveStream] Erro interno na requisição de proxy:", err.message);
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(500, { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': allowOrigin
      });
      res.end("Erro interno no stream proxy do Google Drive: " + err.message);
    }
  });

  req.on('close', () => {
    if (!driveReq.destroyed) {
      driveReq.destroy();
    }
  });

  driveReq.end();
});
