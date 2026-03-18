import { buildApp } from './app.js';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, getDbStatus } from './config/db.js';
import { env } from './config/env.js';

const app = buildApp();
let activeServer = null;
let shuttingDown = false;
let reconnectTimer = null;

function scheduleReconnect(reason = 'database disconnected', attempt = 1) {
  if (shuttingDown) return;
  if (reconnectTimer) return;

  const waitMs = Math.min(env.mongoRetryMs * Math.max(attempt, 1), 30000);
  console.warn(`${reason}. Retrying database connection in ${waitMs}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectDbWithRetry(attempt + 1);
  }, waitMs);
}

async function connectDbWithRetry(attempt = 1) {
  if (shuttingDown) return;
  if (getDbStatus() === 'connected' || getDbStatus() === 'connecting') return;

  try {
    await connectDb();
    console.log('Database connected.');
  } catch (error) {
    console.error(`Database connection failed (attempt ${attempt}): ${error.message}.`);
    scheduleReconnect('Database connection failed', attempt);
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

mongoose.connection.on('disconnected', () => {
  if (shuttingDown) return;
  console.warn('Database connection lost.');
  scheduleReconnect('Database connection lost');
});

mongoose.connection.on('error', (error) => {
  if (shuttingDown) return;
  console.error(`Database connection error: ${error.message}`);
});

process.on('unhandledRejection', (error) => {
  const message = error?.message || String(error || '');
  if (/PoolClearedOnNetworkError|MongoNetworkTimeoutError|server monitor timeout/i.test(message)) {
    console.error(`Transient MongoDB rejection: ${message}`);
    scheduleReconnect('Transient MongoDB network issue');
    return;
  }
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  const message = error?.message || String(error || '');
  if (/PoolClearedOnNetworkError|MongoNetworkTimeoutError|server monitor timeout/i.test(message)) {
    console.error(`Transient MongoDB exception: ${message}`);
    scheduleReconnect('Transient MongoDB exception');
    return;
  }
  console.error('Uncaught exception:', error);
  process.exit(1);
});

start();
