import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Institution } from '../models/Institution.js';
import { User } from '../models/User.js';
import { forbidden, unauthorized } from '../utils/http.js';
import { getInstitutionAccessStatus } from '../utils/institution-access.js';

function getToken(req) {
  const bearer = req.headers.authorization || '';
  if (bearer.startsWith('Bearer ')) {
    return bearer.slice(7);
  }
  return req.cookies?.token || '';
}

export async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return unauthorized(res);

    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub)
      .select('_id role institutionId isActive')
      .lean();
    if (!user || !user.isActive) return unauthorized(res);

    if (env.enforceInstitutionAccess && user.role !== 'super_admin') {
      const institution = await Institution.findById(user.institutionId)
        .select('isActive paymentStatus subscriptionEndsAt')
        .lean();
      const access = getInstitutionAccessStatus(institution);
      if (!access.allowed) return forbidden(res, access.reason);
    }

    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      institutionId: user.institutionId.toString()
    };
    return next();
  } catch (error) {
    return unauthorized(res);
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) return unauthorized(res);
    if (!allowedRoles.includes(req.auth.role)) {
      return forbidden(res);
    }
    return next();
  };
}
