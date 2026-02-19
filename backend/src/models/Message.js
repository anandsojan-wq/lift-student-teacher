import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    messageType: { type: String, enum: ['text', 'voice'], default: 'text' },
    text: { type: String, required: true, trim: true },
    mediaUrl: { type: String, default: '' }
  },
  { timestamps: true }
);

messageSchema.index({ institutionId: 1, createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
