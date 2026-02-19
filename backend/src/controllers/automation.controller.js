import { AutomationLog } from '../models/AutomationLog.js';
import { Institution } from '../models/Institution.js';
import { badRequest, ok } from '../utils/http.js';

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return 50;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > 300) return null;
  return Math.floor(value);
}

async function institutionIdFromCode(institutionCode) {
  const code = String(institutionCode || '').trim();
  if (!code) return null;

  const institution = await Institution.findOne({ institutionId: code }).select('_id').lean();
  return institution?._id || null;
}

export async function superAdminAutomationLogs(req, res) {
  const limit = parseLimit(req.query.limit);
  if (limit === null) return badRequest(res, 'limit must be between 1 and 300.');

  const query = {};
  if (req.query.status) query.status = String(req.query.status).trim();
  if (req.query.eventType) query.eventType = String(req.query.eventType).trim();

  if (req.query.institutionId) {
    const institutionRef = await institutionIdFromCode(req.query.institutionId);
    if (!institutionRef) {
      return ok(res, { logs: [] }, 'No logs found for that institution.');
    }
    query.institutionId = institutionRef;
  }

  const logs = await AutomationLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const institutionIds = logs
    .map((item) => item.institutionId)
    .filter(Boolean);

  const institutions = await Institution.find({ _id: { $in: institutionIds } })
    .select('name institutionId')
    .lean();
  const institutionMap = new Map(
    institutions.map((item) => [item._id.toString(), item])
  );

  const enriched = logs.map((item) => ({
    ...item,
    institution: item.institutionId
      ? institutionMap.get(item.institutionId.toString()) || null
      : null
  }));

  return ok(res, { logs: enriched }, 'Automation logs loaded.');
}

export async function adminAutomationLogs(req, res) {
  const limit = parseLimit(req.query.limit);
  if (limit === null) return badRequest(res, 'limit must be between 1 and 300.');

  const query = {
    institutionId: req.auth.institutionId
  };
  if (req.query.status) query.status = String(req.query.status).trim();
  if (req.query.eventType) query.eventType = String(req.query.eventType).trim();

  const logs = await AutomationLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok(res, { logs }, 'Automation logs loaded.');
}
