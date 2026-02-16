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
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: env.mongoConnectTimeoutMs
  });
}
