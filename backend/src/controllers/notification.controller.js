import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { badRequest, ok } from '../utils/http.js';

const markReadSchema = z.object({
  notificationId: z.string().min(1).optional()
});

export async function myNotifications(req, res) {
  const notifications = await Notification.find({
    institutionId: req.auth.institutionId,
    recipientUserId: req.auth.userId
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return ok(res, { notifications });
}

export async function markNotificationsRead(req, res) {
  const parsed = markReadSchema.safeParse(req.body || {});
  if (!parsed.success) return badRequest(res, 'Invalid notification read payload.');

  const { notificationId } = parsed.data;

  if (notificationId) {
    await Notification.updateOne(
      {
        _id: notificationId,
        institutionId: req.auth.institutionId,
        recipientUserId: req.auth.userId
      },
      { $set: { read: true } }
    );
    return ok(res, {}, 'Notification marked as read.');
  }

  await Notification.updateMany(
    {
      institutionId: req.auth.institutionId,
      recipientUserId: req.auth.userId,
      read: false
    },
    { $set: { read: true } }
  );

  return ok(res, {}, 'All notifications marked as read.');
}
