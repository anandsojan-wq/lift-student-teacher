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
    type: { type: String, enum: ['mcq', 'long'], required: true },
    durationMinutes: { type: Number, required: true },
    scheduledStartAt: { type: Date, default: null },
    scheduledEndAt: { type: Date, default: null },
    audienceMode: { type: String, enum: ['all', 'selected'], default: 'all' },
    assignedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sourcePdfName: { type: String, default: '' },
    questionPdfUrl: { type: String, default: '' },
    questionPdfName: { type: String, default: '' },
    answerKeyPdfUrl: { type: String, default: '' },
    answerKeyPdfName: { type: String, default: '' },
    mcqCorrectMark: { type: Number, default: 1 },
    mcqWrongMark: { type: Number, default: 0 },
    questions: [questionSchema]
  },
  { timestamps: true }
);

testSchema.index({ institutionId: 1, subjectId: 1, createdAt: -1 });

export const Test = mongoose.model('Test', testSchema);
