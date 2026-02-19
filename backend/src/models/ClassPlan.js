import mongoose from 'mongoose';

const classPlanSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    scheduledDate: { type: Date, required: true },
    startTime: { type: String, default: '', trim: true },
    endTime: { type: String, default: '', trim: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', default: null }
  },
  { timestamps: true }
);

classPlanSchema.index({ institutionId: 1, teacherId: 1, scheduledDate: 1 });
classPlanSchema.index({ institutionId: 1, subjectId: 1, scheduledDate: 1 });

export const ClassPlan = mongoose.model('ClassPlan', classPlanSchema);
