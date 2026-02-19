import multer from 'multer';
import { env } from '../config/env.js';
import { uploadBinary } from '../services/storage.service.js';
import { badRequest, created } from '../utils/http.js';

const maxBytes = Math.max(1, Number(env.uploadMaxMb || 12)) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxBytes
  }
});

export const uploadSingleFile = upload.single('file');

function normalizeFolder(value) {
  return String(value || 'uploads')
    .trim()
    .replace(/[^a-z0-9/_-]/gi, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '') || 'uploads';
}

export async function uploadFile(req, res) {
  if (!req.file) {
    return badRequest(res, 'No file uploaded. Use multipart/form-data with field name "file".');
  }

  const folder = normalizeFolder(req.body.folder || 'uploads');
  let saved;
  try {
    saved = await uploadBinary({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folder
    });
  } catch (error) {
    const message = String(error?.message || '').trim();
    if (/Cloudinary configuration missing/i.test(String(error?.message || ''))) {
      return badRequest(
        res,
        'Cloudinary is not configured yet. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Vercel env.'
      );
    }
    if (/Cloudinary upload failed/i.test(message)) {
      return badRequest(res, message);
    }
    return badRequest(res, 'Upload failed. Please try again.');
  }

  return created(
    res,
    {
      file: {
        url: saved.url,
        key: saved.key,
        provider: saved.provider,
        size: req.file.size,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname
      }
    },
    'File uploaded successfully.'
  );
}
