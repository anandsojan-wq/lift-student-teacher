import mongoose from 'mongoose';
import { env } from './env.js';

const READY_STATE = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting'
};

export function getDbStatus() {
  return READY_STATE[mongoose.connection.readyState] || 'unknown';
}

export async function connectDb() {
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return mongoose.connection;
  }

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: env.mongoConnectTimeoutMs,
    connectTimeoutMS: env.mongoConnectTimeoutMs,
    socketTimeoutMS: env.mongoConnectTimeoutMs,
    family: 4
  });
}

export async function disconnectDb() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}
