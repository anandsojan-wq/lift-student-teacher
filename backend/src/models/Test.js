import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    options: [{ type: String }],
    correctIndex: { type: Number }
  },
  { _id: false }
);

const testSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    title: { type: String, required: true },
    type: { type: String, enum: ['mcq', 'long', 'true_false', 'short'], required: true },
    durationMinutes: { type: Number, required: true },
    audienceMode: { type: String, enum: ['all', 'selected'], default: 'all' },
    assignedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sourcePdfName: { type: String, default: '' },
    questions: [questionSchema]
  },
  { timestamps: true }
);

testSchema.index({ institutionId: 1, subjectId: 1, createdAt: -1 });

export const Test = mongoose.model('Test', testSchema);
