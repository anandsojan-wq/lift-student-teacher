const FETCH_TIMEOUT_MS = 20_000;

function sanitizeFileName(value, fallback = 'document.pdf') {
  const clean = String(value || '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ');
  return clean || fallback;
}

function guessMimeTypeFromName(name, fallback = 'application/octet-stream') {
  const lower = String(name || '').trim().toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return fallback;
}

function extractFileNameFromDisposition(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (error) {
      return utf8Match[1];
    }
  }
  const quotedMatch = raw.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const plainMatch = raw.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || '';
}

export function isDataUrl(value) {
  return /^data:[a-z0-9/+.-]+;base64,[a-z0-9+/=\s]+$/i.test(String(value || ''));
}

function decodeDataUrl(value, fallbackFileName, fallbackContentType) {
  const input = String(value || '').trim();
  const match = input.match(/^data:([^;,]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error('Invalid inline file data.');
  }

  return {
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    contentType: match[1] || fallbackContentType || guessMimeTypeFromName(fallbackFileName),
    fileName: sanitizeFileName(fallbackFileName)
  };
}

async function fetchRemoteAsset(sourceUrl, fallbackFileName, fallbackContentType) {
  const response = await fetch(sourceUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Asset fetch failed with status ${response.status}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentTypeHeader = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim();
  const dispositionName = extractFileNameFromDisposition(
    response.headers.get('content-disposition')
  );

  return {
    buffer,
    contentType:
      contentTypeHeader || fallbackContentType || guessMimeTypeFromName(fallbackFileName),
    fileName: sanitizeFileName(dispositionName || fallbackFileName)
  };
}

export async function resolveInlineAsset({
  sourceUrl,
  fallbackFileName = 'document.pdf',
  fallbackContentType = 'application/octet-stream'
}) {
  if (!sourceUrl) {
    throw new Error('Asset URL is missing.');
  }

  if (isDataUrl(sourceUrl)) {
    return decodeDataUrl(sourceUrl, fallbackFileName, fallbackContentType);
  }

  return fetchRemoteAsset(sourceUrl, fallbackFileName, fallbackContentType);
}

export function sendInlineAsset(res, { buffer, contentType, fileName }) {
  const safeName = sanitizeFileName(fileName);
  res.setHeader('Content-Type', contentType || guessMimeTypeFromName(safeName));
  res.setHeader('Content-Disposition', `inline; filename=\"${safeName}\"`);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, noarchive, nosnippet');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  return res.status(200).send(buffer);
}
