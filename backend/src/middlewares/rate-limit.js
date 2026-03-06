import { tooManyRequests } from '../utils/http.js';

const buckets = new Map();
let seenRequests = 0;

function nowMs() {
  return Date.now();
}

function clientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function pruneHits(hits, windowStart) {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  let idx = 0;
  while (idx < hits.length && hits[idx] < windowStart) idx += 1;
  if (idx === 0) return hits;
  return hits.slice(idx);
}

function cleanupStaleBuckets(globalWindowMs) {
  const cutoff = nowMs() - globalWindowMs;
  for (const [key, hits] of buckets.entries()) {
    const pruned = pruneHits(hits, cutoff);
    if (!pruned.length) buckets.delete(key);
    else if (pruned.length !== hits.length) buckets.set(key, pruned);
  }
}

export function createRateLimit({
  windowMs = 15 * 60 * 1000,
  max = 120,
  namespace = 'global',
  keyFn = null,
  skip = null,
  message = 'Too many requests. Please retry after a moment.'
} = {}) {
  const safeWindowMs = toPositiveInt(windowMs, 15 * 60 * 1000);
  const safeMax = toPositiveInt(max, 120);

  return (req, res, next) => {
    try {
      seenRequests += 1;
      if (seenRequests % 500 === 0) {
        cleanupStaleBuckets(safeWindowMs);
      }

      if (typeof skip === 'function' && skip(req)) return next();

      const keySuffix =
        typeof keyFn === 'function'
          ? keyFn(req)
          : `${clientIp(req)}:${req.method}:${req.baseUrl || ''}${req.path || ''}`;
      const key = `${namespace}:${keySuffix}`;
      const currentTime = nowMs();
      const windowStart = currentTime - safeWindowMs;
      const existing = pruneHits(buckets.get(key) || [], windowStart);

      if (existing.length >= safeMax) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing[0] + safeWindowMs - currentTime) / 1000)
        );

        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('X-RateLimit-Limit', String(safeMax));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(Math.ceil((currentTime + retryAfterSeconds * 1000) / 1000)));
        return tooManyRequests(res, message);
      }

      existing.push(currentTime);
      buckets.set(key, existing);

      res.setHeader('X-RateLimit-Limit', String(safeMax));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, safeMax - existing.length)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((currentTime + safeWindowMs) / 1000)));

      return next();
    } catch (error) {
      return next();
    }
  };
}
