import dotenv from 'dotenv';

dotenv.config();

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

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
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMeNow123!',
  storageProvider: (process.env.STORAGE_PROVIDER || 'inline').trim().toLowerCase(),
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 12),
  s3Region: process.env.S3_REGION || 'ap-south-1',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3ForcePathStyle: toBoolean(process.env.S3_FORCE_PATH_STYLE, false),
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
  cloudinaryCloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
  cloudinaryApiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
  cloudinaryApiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
  automationWebhookUrl: process.env.AUTOMATION_WEBHOOK_URL || '',
  automationWebhookSecret: process.env.AUTOMATION_WEBHOOK_SECRET || '',
  automationTimeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS || 10000),
  automationEnabled: toBoolean(process.env.AUTOMATION_ENABLED, true)
};
