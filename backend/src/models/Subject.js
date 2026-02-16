import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    syllabusPdfUrl: { type: String, default: '' },
    syllabusPdfName: { type: String, default: '' }
  },
  { timestamps: true }
);

subjectSchema.index({ institutionId: 1, teacherId: 1, name: 1 }, { unique: true });

export const Subject = mongoose.model('Subject', subjectSchema);
