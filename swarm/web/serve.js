// Tiny static server for the sim page (ESM modules need http://, not file://).
// Usage: node web/serve.js [port]   → http://localhost:5177/  (redirects to /web/)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5177);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    // D-23: the URL a person will try first must work — `/` and `/web` go to the page (query string kept).
    if (p === '/' || p === '/web' || p === '/index.html') { res.writeHead(302, { location: '/web/' + url.search }); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    // DESIGN's build-free token export lives at <repo>/packages/ui/tokens.json once agent/design-system is merged;
    // until then the page falls back to its embedded mirror (test/tokens.test.js gates drift against that branch).
    const base = p.startsWith('/packages/') ? join(root, '..') : root;
    const file = normalize(join(base, p));
    if (!file.startsWith(normalize(base))) { res.writeHead(403); return res.end(); }
    const s = await stat(file);
    if (!s.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`darkspot swarm sim: http://localhost:${port}/  (pid ${process.pid})`));
