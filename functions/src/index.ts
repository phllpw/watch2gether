import { onRequest } from "firebase-functions/v2/https";
import * as https from "https";

/**
 * Cloud Function driveStream
 * Proxies Google Drive API media streams (files.get with alt=media) to bypass CORS blocks
 * and supports HTTP Range Requests for video seek/buffer.
 * Configured with 540 seconds timeout and 512MiB memory to support large video files.
 */
export const driveStream = onRequest({
  cors: true,
  timeoutSeconds: 540,
  memory: "512MiB"
}, (req, res) => {
  const method = req.method;

  // 1. Accept only GET and OPTIONS methods
  if (method !== 'GET' && method !== 'OPTIONS') {
    res.writeHead(405, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': 'http://localhost:5173'
    });
    res.end("Método Não Permitido. Use GET ou OPTIONS.");
    return;
  }

  // 2. Respond OPTIONS preflight correctly
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
      'Access-Control-Max-Age': '3600'
    });
    res.end();
    return;
  }

  // 3. Validate fileId and accessToken
  const fileId = req.query.fileId as string;
  const accessToken = req.query.accessToken as string;

  if (!fileId || !accessToken) {
    res.writeHead(400, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': 'http://localhost:5173'
    });
    res.end("Erro: Parâmetros fileId ou accessToken ausentes na query string.");
    return;
  }

  // Security: Do NOT log the accessToken, full req.url or querystring
  console.log(`[driveStream] Iniciando proxy de mídia para o arquivo: ${fileId}`);

  // 4. Build Google Drive API media fetch url and headers
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const driveHeaders: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`
  };

  // Forward the client's Range header if it exists
  if (req.headers.range) {
    driveHeaders['Range'] = req.headers.range as string;
  }

  // 5. Query Google Drive API
  const driveReq = https.request(driveUrl, {
    method: 'GET',
    headers: driveHeaders
  }, (driveRes) => {
    const statusCode = driveRes.statusCode || 200;

    // Handle Google Drive errors (401, 403, 404, etc.)
    if (statusCode >= 400) {
      console.error(`[driveStream] Erro retornado pela Google Drive API: ${statusCode}`);
      let body = '';
      driveRes.on('data', chunk => body += chunk);
      driveRes.on('end', () => {
        if (!res.writableEnded && !res.headersSent) {
          res.writeHead(statusCode, { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': 'http://localhost:5173'
          });
          res.end(body || JSON.stringify({ error: { message: "Erro ao acessar API do Google Drive", code: statusCode } }));
        }
      });
      return;
    }

    // 6. Copy important headers and pipe stream
    const resHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Accept-Ranges': 'bytes' // Guarantee Accept-Ranges: bytes for buffer seek
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
        'Access-Control-Allow-Origin': 'http://localhost:5173'
      });
      res.end("Erro interno no stream proxy do Google Drive: " + err.message);
    }
  });

  // Abort/destroy Google Drive request if client drops connection
  req.on('close', () => {
    if (!driveReq.destroyed) {
      driveReq.destroy();
      console.log(`[driveStream] Conexão do cliente fechada. Conexão do Google Drive abortada.`);
    }
  });

  driveReq.end();
});
