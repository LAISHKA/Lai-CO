// Локальный сервер для игры: node tools/serve.mjs [--port 8765] [--host 0.0.0.0]
// Нужен, чтобы открыть игру на телевизоре/телефоне/планшете в той же сети.
// Только чтение файлов из папки проекта, кэш отключён.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(arg('port', 8765));
const HOST = arg('host', '0.0.0.0');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254'))
    .map((i) => i.address);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = normalize(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('403\n');
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + pathname + '\n');
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
      'content-length': body.length
    });
    res.end(body);
    console.log('200 ' + pathname);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 ' + error.message + '\n');
  }
});

server.listen(PORT, HOST, () => {
  console.log('Игра доступна:');
  console.log('  на этом ПК:        http://localhost:' + PORT + '/');
  for (const ip of lanAddresses()) {
    console.log('  в локальной сети:  http://' + ip + ':' + PORT + '/   ← для телевизора');
  }
  console.log('Папка: ' + ROOT);
  console.log('Остановка: Ctrl+C');
  if (HOST === '0.0.0.0') {
    console.log('Если телевизор не подключается — Windows Firewall блокирует входящие.');
    console.log('В PowerShell от администратора:');
    console.log('  New-NetFirewallRule -DisplayName "detective-game" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ' + PORT);
  }
});
