import mongoose from 'mongoose';

const analyticsEventSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'teacher', 'student', 'system'],
      default: 'system'
    },
    eventType: { type: String, required: true, trim: true },
    stage: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

analyticsEventSchema.index({ institutionId: 1, createdAt: -1 });
analyticsEventSchema.index({ role: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });

export const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);
