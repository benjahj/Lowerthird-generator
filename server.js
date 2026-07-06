// LT Fabrik — lille lokal server uden dependencies.
// Serverer app'en + giver adgang til billedmapper via /api.
// Kan køre på tre måder:
//  1) node server.js / start.bat  (rod = projektmappen)
//  2) selvstændig .exe via Node SEA (app-filer indlejret, rod = exe-mappen)
//  3) som modul i Electron-appen: startServer({ root, port, pickRoot })
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let sea = null;
try {
  const s = require('node:sea');
  if (s.isSea()) sea = s;
} catch { /* almindelig node-kørsel */ }

const DEFAULT_ROOT = sea ? path.dirname(process.execPath) : __dirname;
const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 8617;

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

// .svg er bevidst udeladt: createImageBitmap kan ikke dekode SVG-blobs
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, rel));
  // path.relative afviser både ..-udbrud og søskendemapper med samme præfiks
  const r = path.relative(path.normalize(root), p);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return p;
}

function listFolders(root) {
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
  walk(root, '', 3);
  return out;
}

function listFiles(root, relDir) {
  const dir = safeJoin(root, relDir);
  if (!dir) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('._') && IMG_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
}

function startServer(opts = {}) {
  const getRoot = typeof opts.root === 'function' ? opts.root : () => opts.root || DEFAULT_ROOT;
  // app-filer: i Electron ligger de i app-pakken (samme mappe som denne fil)
  const appDir = opts.appDir || __dirname;

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      // decodeURIComponent/statSync m.fl. kan kaste — svar pænt i stedet for at crashe
      try {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Ugyldig forespørgsel');
      } catch { /* svar allerede påbegyndt */ }
    }
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/caps') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ pickroot: !!opts.pickRoot, root: getRoot() }));
      return;
    }

    if (pathname === '/api/pickroot' && opts.pickRoot) {
      try { await opts.pickRoot(); } catch { /* annulleret */ }
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ root: getRoot() }));
      return;
    }

    if (pathname === '/api/folders') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify(listFolders(getRoot())));
      return;
    }

    if (pathname === '/api/files') {
      const files = listFiles(getRoot(), url.searchParams.get('dir') || '');
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

    // app-filer fra app-mappen, billeder fra rod-mappen
    const isAppFile = !!SEA_ASSETS[rel];
    const file = isAppFile ? path.join(appDir, rel.slice(1)) : safeJoin(getRoot(), rel);
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
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port !== undefined ? opts.port : DEFAULT_PORT, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

module.exports = { startServer };

// direkte kørsel (node server.js eller SEA-exe)
if (require.main === module || sea) {
  startServer().then(({ port }) => {
    console.log('LT Fabrik kører på  http://localhost:' + port);
    console.log('Billedmapper læses fra: ' + DEFAULT_ROOT);
    console.log('Luk med Ctrl+C (eller luk dette vindue).');
    if (sea && process.platform === 'win32' && process.env.LT_NO_OPEN !== '1') {
      require('child_process').exec('start "" "http://localhost:' + port + '"', { shell: 'cmd.exe' });
    }
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('Porten er optaget — kører LT Fabrik allerede? Luk den anden, eller sæt PORT=xxxx.');
    } else {
      console.error(e.message);
    }
    setTimeout(() => process.exit(1), 8000);
  });
}
