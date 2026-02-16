const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const maxPortHops = Number(process.env.MAX_PORT_HOPS || 20);
const publicDir = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${host}:${port}`);
  const safeUrl = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const filePath = path.join(publicDir, safeUrl);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

function listenWithPortFallback(startPort, hopsRemaining) {
  return new Promise((resolve, reject) => {
    const tryListen = (targetPort, retriesLeft) => {
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(targetPort);
      };

      const onError = (error) => {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE' && retriesLeft > 0) {
          console.warn(`Port ${targetPort} is busy. Trying ${targetPort + 1}...`);
          tryListen(targetPort + 1, retriesLeft - 1);
          return;
        }
        reject(error);
      };

      server.once('listening', onListening);
      server.once('error', onError);
      server.listen(targetPort, host);
    };

    tryListen(startPort, hopsRemaining);
  });
}

listenWithPortFallback(port, maxPortHops)
  .then((activePort) => {
    const localUrl = `http://localhost:${activePort}`;
    const loopbackUrl = `http://127.0.0.1:${activePort}`;
    console.log(`Frontend running on ${host}:${activePort}`);
    console.log(`Open: ${localUrl}`);
    console.log(`Fallback: ${loopbackUrl}`);
  })
  .catch((error) => {
    console.error(`Failed to start frontend: ${error.message}`);
    process.exit(1);
  });
