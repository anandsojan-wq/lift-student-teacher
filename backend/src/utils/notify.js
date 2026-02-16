import { Notification } from '../models/Notification.js';

export async function notifyUsers({
  institutionId,
  recipientUserIds,
  type,
  message
}) {
  const unique = Array.from(
    new Set(
      (recipientUserIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );

  if (!unique.length) return;

  await Notification.insertMany(
    unique.map((recipientUserId) => ({
      institutionId,
      recipientUserId,
      type,
      message,
      read: false
    }))
  );
}
