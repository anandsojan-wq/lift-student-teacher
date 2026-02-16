import { z } from 'zod';
import { Message } from '../models/Message.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { User } from '../models/User.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';

const sendMessageSchema = z.object({
  toUserId: z.string().min(1),
  text: z.string().min(1).max(5000)
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
    text: payload.text.trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message: 'New message from your teacher.'
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
    text: payload.text.trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message: 'New message from a student.'
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
    text: payload.text.trim()
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [target._id],
    type: 'message',
    message: 'New message from admin.'
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
  const users = await User.find({
    institutionId: req.auth.institutionId,
    role: { $in: ['teacher', 'student'] },
    isActive: true
  })
    .select('fullName username role')
    .sort({ role: 1, fullName: 1 })
    .lean();

  return ok(res, { users });
}
