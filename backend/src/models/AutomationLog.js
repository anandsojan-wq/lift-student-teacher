import mongoose from 'mongoose';

const automationLogSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      default: null
    },
    eventType: { type: String, required: true, trim: true },
    triggerRole: {
      type: String,
      enum: ['super_admin', 'admin', 'teacher', 'student', 'system'],
      default: 'system'
    },
    status: {
      type: String,
      enum: ['skipped', 'sent', 'failed'],
      required: true
    },
    destination: { type: String, default: 'webhook' },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    responseStatus: { type: Number, default: null },
    responseBody: { type: String, default: '' },
    errorMessage: { type: String, default: '' }
  },
  { timestamps: true }
);

automationLogSchema.index({ createdAt: -1 });
automationLogSchema.index({ institutionId: 1, createdAt: -1 });
automationLogSchema.index({ eventType: 1, createdAt: -1 });

export const AutomationLog = mongoose.model('AutomationLog', automationLogSchema);
