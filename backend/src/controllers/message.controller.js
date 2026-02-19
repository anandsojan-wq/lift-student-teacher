import { z } from 'zod';
import { Message } from '../models/Message.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';

const sendMessageSchema = z
  .object({
    toUserId: z.string().min(1),
    messageType: z.enum(['text', 'voice']).default('text'),
    text: z.string().max(5000).optional(),
    mediaUrl: z.string().trim().optional().or(z.literal(''))
  })
  .superRefine((payload, ctx) => {
    if (payload.messageType === 'text' && !String(payload.text || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Text is required for normal messages.'
      });
    }
    if (payload.messageType === 'voice' && !String(payload.mediaUrl || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mediaUrl'],
        message: 'Voice note URL is required.'
      });
    }
  });

function mapConversationMessages(messages, userMap) {
  return messages.map((message) => {
    const from = userMap.get(message.fromUserId.toString());
    const to = userMap.get(message.toUserId.toString());
    return {
      ...message,
      fromUser: from
        ? {
            id: from._id,
            role: from.role,
            fullName: from.fullName,
            username: from.username
          }
        : null,
      toUser: to
        ? {
            id: to._id,
            role: to.role,
            fullName: to.fullName,
            username: to.username
          }
        : null
    };
  });
}

async function fetchConversation(institutionId, userAId, userBId) {
  const messages = await Message.find({
    institutionId,
    $or: [
      { fromUserId: userAId, toUserId: userBId },
      { fromUserId: userBId, toUserId: userAId }
    ]
  })
    .sort({ createdAt: 1 })
    .limit(300)
    .lean();

  const users = await User.find({
    _id: { $in: [userAId, userBId] },
    institutionId
  })
    .select('role fullName username')
    .lean();
  const userMap = new Map(users.map((user) => [user._id.toString(), user]));
  return mapConversationMessages(messages, userMap);
}

export async function teacherSendMessage(req, res) {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid message payload.');

  const payload = parsed.data;
  const target = await User.findOne({
    _id: payload.toUserId,
    institutionId: req.auth.institutionId,
    role: 'student',
    isActive: true
  }).lean();
  if (!target) return notFound(res, 'Student not found.');

  const profile = await StudentProfile.findOne({
    userId: target._id,
    teacherId: req.auth.userId
  }).lean();
  if (!profile) return notFound(res, 'Student is not assigned to this teacher.');

  const message = await Message.create({
    institutionId: req.auth.institutionId,
    fromUserId: req.auth.userId,
    toUserId: target._id,
    messageType: payload.messageType,
    text:
      payload.messageType === 'voice'
        ? String(payload.text || 'Voice note').trim()
        : String(payload.text || '').trim(),
    mediaUrl: String(payload.mediaUrl || '').trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message:
      payload.messageType === 'voice'
        ? 'New voice note from your teacher.'
        : 'New message from your teacher.'
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'teacher',
    eventType: 'message_sent',
    stage: 'engagement',
    metadata: {
      toRole: 'student'
    }
  });

  return created(res, { message }, 'Message sent.');
}

export async function studentSendMessage(req, res) {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid message payload.');

  const payload = parsed.data;
  const target = await User.findOne({
    _id: payload.toUserId,
    institutionId: req.auth.institutionId,
    role: { $in: ['teacher', 'admin'] },
    isActive: true
  }).lean();
  if (!target) return notFound(res, 'Teacher/Admin not found.');

  const profile = await StudentProfile.findOne({
    userId: req.auth.userId
  }).lean();
  if (!profile) return notFound(res, 'Student profile not found.');

  if (target.role === 'teacher' && profile.teacherId.toString() !== target._id.toString()) {
    return badRequest(res, 'Student can message only assigned teacher.');
  }

  const message = await Message.create({
    institutionId: req.auth.institutionId,
    fromUserId: req.auth.userId,
    toUserId: target._id,
    messageType: payload.messageType,
    text:
      payload.messageType === 'voice'
        ? String(payload.text || 'Voice note').trim()
        : String(payload.text || '').trim(),
    mediaUrl: String(payload.mediaUrl || '').trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message:
      payload.messageType === 'voice'
        ? 'New voice note from a student.'
        : 'New message from a student.'
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'student',
    eventType: 'message_sent',
    stage: 'engagement',
    metadata: {
      toRole: target.role
    }
  });

  return created(res, { message }, 'Message sent.');
}

export async function adminSendMessage(req, res) {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid message payload.');

  const payload = parsed.data;
  const target = await User.findOne({
    _id: payload.toUserId,
    institutionId: req.auth.institutionId,
    role: { $in: ['teacher', 'student', 'admin'] },
    isActive: true
  }).lean();
  if (!target) return notFound(res, 'Recipient not found.');

  const message = await Message.create({
    institutionId: req.auth.institutionId,
    fromUserId: req.auth.userId,
    toUserId: target._id,
    messageType: payload.messageType,
    text:
      payload.messageType === 'voice'
        ? String(payload.text || 'Voice note').trim()
        : String(payload.text || '').trim(),
    mediaUrl: String(payload.mediaUrl || '').trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message:
      payload.messageType === 'voice'
        ? 'New voice note from admin.'
        : 'New message from admin.'
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'message_sent',
    stage: 'engagement',
    metadata: {
      toRole: target.role
    }
  });

  return created(res, { message }, 'Message sent.');
}

export async function teacherConversation(req, res) {
  const studentId = String(req.query.studentId || '').trim();
  if (!studentId) return badRequest(res, 'studentId is required.');

  const target = await User.findOne({
    _id: studentId,
    institutionId: req.auth.institutionId,
    role: 'student'
  }).lean();
  if (!target) return notFound(res, 'Student not found.');

  const profile = await StudentProfile.findOne({
    userId: target._id,
    teacherId: req.auth.userId
  }).lean();
  if (!profile) return notFound(res, 'Student is not assigned to this teacher.');

  const messages = await fetchConversation(req.auth.institutionId, req.auth.userId, target._id);
  return ok(res, { messages });
}

export async function studentConversation(req, res) {
  const teacherId = String(req.query.teacherId || '').trim();
  if (!teacherId) return badRequest(res, 'teacherId is required.');

  const target = await User.findOne({
    _id: teacherId,
    institutionId: req.auth.institutionId,
    role: { $in: ['teacher', 'admin'] }
  }).lean();
  if (!target) return notFound(res, 'Teacher/Admin not found.');

  const profile = await StudentProfile.findOne({
    userId: req.auth.userId
  }).lean();
  if (!profile) return notFound(res, 'Student profile not found.');

  if (target.role === 'teacher' && profile.teacherId.toString() !== target._id.toString()) {
    return badRequest(res, 'Teacher not assigned to this student.');
  }

  const messages = await fetchConversation(req.auth.institutionId, req.auth.userId, target._id);
  return ok(res, { messages });
}

export async function adminConversation(req, res) {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return badRequest(res, 'userId is required.');

  const target = await User.findOne({
    _id: userId,
    institutionId: req.auth.institutionId,
    role: { $in: ['teacher', 'student', 'admin'] }
  }).lean();
  if (!target) return notFound(res, 'User not found.');

  const messages = await fetchConversation(req.auth.institutionId, req.auth.userId, target._id);
  return ok(res, { messages });
}

export async function studentTeacherList(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('teacherId')
    .lean();
  if (!profile) return ok(res, { teachers: [] });

  const teachers = await User.find({
    institutionId: req.auth.institutionId,
    _id: profile.teacherId,
    role: 'teacher',
    isActive: true
  })
    .select('fullName username')
    .lean();

  return ok(res, { teachers });
}

export async function adminUserList(req, res) {
  const role = String(req.query.role || 'all').trim().toLowerCase();
  const subjectId = String(req.query.subjectId || '').trim();
  const q = String(req.query.q || '').trim();

  const roles = role === 'teacher'
    ? ['teacher']
    : role === 'student'
      ? ['student']
      : ['teacher', 'student'];

  let studentIds = null;
  if (subjectId) {
    const profileQuery = {};
    if (!roles.includes('teacher')) {
      profileQuery.subjects = subjectId;
    } else {
      profileQuery.subjects = subjectId;
    }
    const profiles = await StudentProfile.find(profileQuery)
      .select('userId')
      .lean();
    studentIds = profiles.map((item) => item.userId.toString());
  }

  const query = {
    institutionId: req.auth.institutionId,
    role: { $in: roles },
    isActive: true
  };
  if (q) query.fullName = { $regex: q, $options: 'i' };

  if (subjectId && role === 'student') {
    query._id = { $in: studentIds || [] };
  }

  const users = await User.find(query)
    .select('fullName username role')
    .sort({ role: 1, fullName: 1 })
    .lean();

  if (subjectId && role === 'all') {
    const filtered = users.filter((item) => {
      if (item.role === 'teacher') return true;
      return (studentIds || []).includes(item._id.toString());
    });
    return ok(res, { users: filtered });
  }

  return ok(res, { users });
}
