import mongoose from 'mongoose';

const studentProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    usageSeconds: { type: Number, default: 0 },
    parentEmail: { type: String, default: '', trim: true, lowercase: true },
    parentPhone: { type: String, default: '', trim: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    streakDays: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    badges: [{ type: String }],
    focusModeEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);
