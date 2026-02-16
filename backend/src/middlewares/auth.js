import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { forbidden, unauthorized } from '../utils/http.js';

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
    const user = await User.findById(payload.sub).lean();
    if (!user || !user.isActive) return unauthorized(res);

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
