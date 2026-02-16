import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    resourceType: {
      type: String,
      enum: ['pdf', 'ebook', 'video', 'link'],
      required: true
    },
    title: { type: String, default: '', trim: true },
    value: { type: String, required: true },
    source: { type: String, enum: ['file', 'text'], required: true },
    keywords: [{ type: String }]
  },
  { timestamps: true }
);

resourceSchema.index({ institutionId: 1, subjectId: 1, resourceType: 1, createdAt: -1 });

export const Resource = mongoose.model('Resource', resourceSchema);
