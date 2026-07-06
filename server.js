// LT Fabrik — lille lokal server uden dependencies.
// Serverer app'en + giver adgang til billedmapper i projektmappen via /api.
// Kan også køre som selvstændig .exe (Node SEA): app-filerne er da indlejret,
// og billedmapper læses fra mappen ved siden af exe-filen.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let sea = null;
try {
  const s = require('node:sea');
  if (s.isSea()) sea = s;
} catch { /* almindelig node-kørsel */ }

const ROOT = sea ? path.dirname(process.execPath) : __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 8617;

// app-filer indlejret i exe'en
const SEA_ASSETS = { '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg']);

function safeJoin(rel) {
  const p = path.normalize(path.join(ROOT, rel));
  if (!p.startsWith(ROOT)) return null; // ingen sti-traversering
  return p;
}

function listFolders() {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let imgs = 0;
    for (const e of entries) {
      if (e.isFile() && !e.name.startsWith('._') && IMG_EXT.has(path.extname(e.name).toLowerCase())) imgs++;
    }
    if (imgs > 0 && rel) out.push({ dir: rel, count: imgs });
    if (depth <= 0) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__MACOSX') {
        walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth - 1);
      }
    }
  };
  walk(ROOT, '', 3);
  return out;
}

function listFiles(relDir) {
  const dir = safeJoin(relDir);
  if (!dir) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('._') && IMG_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/folders') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(listFolders()));
    return;
  }

  if (pathname === '/api/files') {
    const files = listFiles(url.searchParams.get('dir') || '');
    if (!files) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(files));
    return;
  }

  let rel = pathname === '/' ? '/index.html' : pathname;

  if (sea && SEA_ASSETS[rel]) {
    const buf = Buffer.from(sea.getAsset(SEA_ASSETS[rel]));
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return;
  }

  const file = safeJoin(rel);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — findes ikke');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log('LT Fabrik kører på  http://localhost:' + PORT);
  console.log('Billedmapper læses fra: ' + ROOT);
  console.log('Luk med Ctrl+C (eller luk dette vindue).');
  // som .exe: åbn browseren automatisk ved dobbeltklik
  if (sea && process.platform === 'win32' && process.env.LT_NO_OPEN !== '1') {
    require('child_process').exec('start "" "http://localhost:' + PORT + '"', { shell: 'cmd.exe' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' er optaget — kører LT Fabrik allerede? Luk den anden, eller sæt PORT=xxxx.');
  } else {
    console.error(e.message);
  }
  setTimeout(() => process.exit(1), 8000);
});
