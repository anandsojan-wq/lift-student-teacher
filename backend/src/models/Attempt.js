import mongoose from 'mongoose';

const attemptSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
    type: { type: String, enum: ['mcq', 'long'], required: true },
    scorePercent: { type: Number, default: null },
    correctCount: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    timeSpentSeconds: { type: Number, default: 0 },
    answers: [{ type: mongoose.Schema.Types.Mixed }]
  },
  { timestamps: true }
);

attemptSchema.index({ studentId: 1, createdAt: -1 });

export const Attempt = mongoose.model('Attempt', attemptSchema);
