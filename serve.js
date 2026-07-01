const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PUBLIC = path.join(__dirname, 'public');
const PORT = process.argv[2] || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let filePath = path.join(PUBLIC, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
