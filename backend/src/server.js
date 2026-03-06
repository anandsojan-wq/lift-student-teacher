import { buildApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';

const app = buildApp();
let activeServer = null;
let shuttingDown = false;

async function connectDbWithRetry(attempt = 1) {
  try {
    await connectDb();
    console.log('Database connected.');
  } catch (error) {
    const waitMs = Math.min(env.mongoRetryMs * Math.max(attempt, 1), 30000);
    console.error(
      `Database connection failed (attempt ${attempt}): ${error.message}. Retrying in ${waitMs}ms...`
    );
    setTimeout(() => {
      void connectDbWithRetry(attempt + 1);
    }, waitMs);
  }
}

function listenWithPortFallback(startPort, hopsRemaining) {
  return new Promise((resolve, reject) => {
    const server = app.listen(startPort, env.host, () => {
      resolve({ server, port: startPort });
    });

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && hopsRemaining > 0) {
        console.warn(`Port ${startPort} is busy. Trying ${startPort + 1}...`);
        setTimeout(() => {
          void listenWithPortFallback(startPort + 1, hopsRemaining - 1).then(resolve).catch(reject);
        }, 100);
        return;
      }
      reject(error);
    });
  });
}

async function start() {
  try {
    const { port, server } = await listenWithPortFallback(env.port, env.maxPortHops);
    activeServer = server;
    console.log(`Backend running on http://${env.host}:${port}`);
    void connectDbWithRetry();
  } catch (error) {
    console.error('Failed to start backend:', error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Shutting down backend...`);

  try {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
    }
    await disconnectDb();
  } catch (error) {
    console.error(`Error during shutdown: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

start();
