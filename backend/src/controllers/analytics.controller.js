import { Institution } from '../models/Institution.js';
import { badRequest, notFound, ok } from '../utils/http.js';
import {
  getGlobalAnalytics,
  getInstitutionAnalytics
} from '../services/analytics.service.js';

function parseDays(raw) {
  if (raw === undefined || raw === null || raw === '') return 30;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1 || days > 365) return null;
  return Math.floor(days);
}

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return 100;
  const limit = Number(raw);
  if (!Number.isFinite(limit) || limit < 1 || limit > 300) return null;
  return Math.floor(limit);
}

export async function adminAnalytics(req, res) {
  const days = parseDays(req.query.days);
  if (days === null) return badRequest(res, 'days must be between 1 and 365.');

  const analytics = await getInstitutionAnalytics({
    institutionId: req.auth.institutionId,
    windowDays: days
  });

  return ok(res, { analytics }, 'Institution analytics loaded.');
}

export async function superAdminGlobalAnalytics(req, res) {
  const days = parseDays(req.query.days);
  const limit = parseLimit(req.query.limit);
  if (days === null) return badRequest(res, 'days must be between 1 and 365.');
  if (limit === null) return badRequest(res, 'limit must be between 1 and 300.');

  const analytics = await getGlobalAnalytics({
    windowDays: days,
    limit
  });

  return ok(res, { analytics }, 'Global analytics loaded.');
}

export async function superAdminInstitutionAnalytics(req, res) {
  const days = parseDays(req.query.days);
  if (days === null) return badRequest(res, 'days must be between 1 and 365.');

  const institutionIdCode = String(req.params.institutionId || '').trim();
  if (!institutionIdCode) return badRequest(res, 'Institution ID is required.');

  const institution = await Institution.findOne({ institutionId: institutionIdCode })
    .select('_id')
    .lean();
  if (!institution) return notFound(res, 'Institution not found.');

  const analytics = await getInstitutionAnalytics({
    institutionId: institution._id,
    windowDays: days
  });

  return ok(res, { analytics }, 'Institution analytics loaded.');
}
