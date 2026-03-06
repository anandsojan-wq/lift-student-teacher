import { randomUUID } from 'crypto';

function normalizeIncomingRequestId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 120);
}

export function attachRequestContext(req, res, next) {
  const incoming = normalizeIncomingRequestId(req.headers['x-request-id']);
  const requestId = incoming || randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}
