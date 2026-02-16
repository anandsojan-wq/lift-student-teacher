import dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 5050),
  maxPortHops: Number(process.env.MAX_PORT_HOPS || 20),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lift_edtech',
  mongoRetryMs: Number(process.env.MONGO_RETRY_MS || 5000),
  mongoConnectTimeoutMs: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: String(
    process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  superAdminInstitutionId: process.env.SUPER_ADMIN_INSTITUTION_ID || 'LIFT-HQ-0000',
  superAdminUsername: process.env.SUPER_ADMIN_USERNAME || 'owner',
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMeNow123!'
};
