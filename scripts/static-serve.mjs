// 极简静态文件服务器，仅用于 UI smoke：服务 DIST_DIR 下的单文件构建。
// 任何未知路径回退到 index.html（配合 hash 路由）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const distDir = process.env.DIST_DIR || path.resolve('dist');
const port = Number(process.env.PORT || 4319);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(distDir, urlPath === '/' ? '/index.html' : urlPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('read error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stderr.write(`static-serve: listening on http://127.0.0.1:${port} (dist=${distDir})\n`);
});
