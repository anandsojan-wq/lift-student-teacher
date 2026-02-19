import crypto from 'crypto';
import { env } from '../config/env.js';

const DEFAULT_INLINE_TYPES = new Set([
  'application/pdf',
  'application/epub+zip',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'audio/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg'
]);

let s3Client = null;
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 20_000;

function safeExtFromName(name) {
  const raw = String(name || '').trim();
  const ext = raw.includes('.') ? raw.split('.').pop() : '';
  return ext ? ext.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('epub')) return 'epub';
  if (mime.includes('msword')) return 'doc';
  if (mime.includes('officedocument.wordprocessingml')) return 'docx';
  if (mime.includes('officedocument.presentationml')) return 'pptx';
  if (mime.includes('officedocument.spreadsheetml')) return 'xlsx';
  if (mime.includes('powerpoint')) return 'ppt';
  if (mime.includes('excel')) return 'xls';
  if (mime.includes('plain')) return 'txt';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('mpeg')) return 'mp3';
  return '';
}

function normalizeFolder(folder) {
  const safe = String(folder || 'uploads')
    .trim()
    .replace(/[^a-z0-9/_-]/gi, '-')
    .replace(/\/+/g, '/')
    .replace(/\/\/+/, '/')
    .replace(/^\/+|\/+$/g, '');

  return safe || 'uploads';
}

function buildObjectKey({ folder, mimeType, originalName }) {
  const safeFolder = normalizeFolder(folder);
  const ext = safeExtFromName(originalName) || extensionFromMime(mimeType) || 'bin';
  const token = crypto.randomBytes(8).toString('hex');
  return `${safeFolder}/${Date.now()}-${token}.${ext}`;
}

async function getS3Client() {
  if (s3Client) return s3Client;

  if (!env.s3Bucket || !env.s3AccessKeyId || !env.s3SecretAccessKey) {
    throw new Error('S3 configuration missing. Set S3 bucket and credentials.');
  }

  const { S3Client } = await import('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: env.s3Region,
    ...(env.s3Endpoint ? { endpoint: env.s3Endpoint } : {}),
    forcePathStyle: env.s3ForcePathStyle,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey
    }
  });

  return s3Client;
}

function buildS3PublicUrl(key) {
  if (env.s3PublicBaseUrl) {
    const base = env.s3PublicBaseUrl.replace(/\/+$/g, '');
    return `${base}/${key}`;
  }

  if (env.s3Endpoint && env.s3ForcePathStyle) {
    const endpoint = env.s3Endpoint.replace(/\/+$/g, '');
    return `${endpoint}/${env.s3Bucket}/${key}`;
  }

  return `s3://${env.s3Bucket}/${key}`;
}

async function uploadToS3({ buffer, mimeType, originalName, folder }) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const key = buildObjectKey({ folder, mimeType, originalName });
  const client = await getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream'
    })
  );

  return {
    provider: 's3',
    key,
    url: buildS3PublicUrl(key)
  };
}

function cloudinarySignature(params) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(`${serialized}${env.cloudinaryApiSecret}`).digest('hex');
}

async function uploadToCloudinary({ buffer, mimeType, originalName, folder }) {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new Error('Cloudinary configuration missing.');
  }

  const key = buildObjectKey({ folder, mimeType, originalName }).replace(/\.[^.]+$/, '');
  const resourceType = String(mimeType || '').startsWith('video/') ? 'video' : 'raw';
  const dataUri = `data:${mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const safeFolder = normalizeFolder(folder);
  const signature = cloudinarySignature({
    folder: safeFolder,
    public_id: key,
    timestamp
  });

  const formData = new FormData();
  formData.append('file', dataUri);
  formData.append('folder', safeFolder);
  formData.append('public_id', key);
  formData.append('timestamp', String(timestamp));
  formData.append('api_key', env.cloudinaryApiKey);
  formData.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/${resourceType}/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(CLOUDINARY_UPLOAD_TIMEOUT_MS)
  });
  const payloadText = await response.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    throw new Error(`Cloudinary upload failed (${response.status}): unexpected response.`);
  }
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Cloudinary upload failed (${response.status}): ${message}`);
  }

  return {
    provider: 'cloudinary',
    key: payload.public_id,
    url: payload.secure_url
  };
}

function uploadInline({ buffer, mimeType, originalName, folder }) {
  const key = buildObjectKey({ folder, mimeType, originalName });

  const resolvedMime = mimeType || 'application/octet-stream';
  const safeMime = DEFAULT_INLINE_TYPES.has(resolvedMime)
    ? resolvedMime
    : 'application/octet-stream';

  return {
    provider: 'inline',
    key,
    url: `data:${safeMime};base64,${buffer.toString('base64')}`
  };
}

export async function uploadBinary({
  buffer,
  mimeType,
  originalName,
  folder = 'uploads'
}) {
  if (!buffer || !buffer.length) {
    throw new Error('Empty file payload.');
  }

  const provider = env.storageProvider;
  if (provider === 's3') {
    return uploadToS3({ buffer, mimeType, originalName, folder });
  }

  if (provider === 'cloudinary') {
    return uploadToCloudinary({ buffer, mimeType, originalName, folder });
  }

  return uploadInline({ buffer, mimeType, originalName, folder });
}
