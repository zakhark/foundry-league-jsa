// Tiny static file server for previewing the built site: npm run serve
//
// Uses port 3000 (or PORT). If that port is busy or blocked, it tries the next
// ones: Windows reserves blocks of ports for Hyper-V/WSL/Docker networking, and
// those blocks change after a restart, so a port that worked before can fail
// with "EACCES: permission denied".
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const root = path.resolve(config.outDir);
const firstPort = Number(process.env.PORT) || 3000;
const TRIES = 20;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.ics': 'text/calendar; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Like the real hosts, show the site's own 404 page.
      fs.readFile(path.join(root, '404.html'), (e, page) => {
        res.writeHead(404, { 'content-type': e ? 'text/plain' : types['.html'] }).end(e ? 'Not found' : page);
      });
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

let port = firstPort;
server.on('error', (err) => {
  if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && port < firstPort + TRIES - 1) {
    console.log(`Port ${port} is ${err.code === 'EACCES' ? 'blocked by Windows' : 'in use'}; trying ${port + 1}`);
    port++;
    server.listen(port);
    return;
  }
  console.error(`Couldn't start the preview server (${err.code} on port ${port}). Try another one, e.g. PORT=5000 npm run serve`);
  process.exit(1);
});
server.on('listening', () => console.log(`Serving ${root} at http://localhost:${port}`));
server.listen(port);
