/* Friend 服务：node serve.mjs  (PORT 可改端口)
 * 场景只用静帧 webp；保留 Range 支持便于以后加任意媒体，但应用本身不加载视频。 */
import { friendApi, realtimeAccount } from './friend-api.mjs';
import { attachRealtimeCalls } from './friend-realtime.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4180);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let url, urlPath;
  try { url = new URL(req.url, 'http://localhost'); urlPath = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end('bad request'); return; }
  if (url.pathname.startsWith('/api/')) { void friendApi(req, res, url); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.resolve(ROOT, '.' + urlPath);
  const relative = path.relative(ROOT, file);
  if (!/^(?:index\.html|app\.js|chat-format\.js|styles\.css|(?:assets|data)[\\/][a-z0-9_.\\/-]+)$/i.test(relative)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : st.size - 1;
        if (start <= end && end < st.size) {
          res.writeHead(206, {
            'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`,
            'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache'
          });
          fs.createReadStream(file, { start, end }).pipe(res); return;
        }
      }
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});
attachRealtimeCalls(server, realtimeAccount);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`笺墨溪-Friend 已启动: http://127.0.0.1:${PORT}/`);
});
