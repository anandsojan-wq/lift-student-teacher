export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toKeywordArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}
