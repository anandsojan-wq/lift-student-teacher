import mongoose from 'mongoose';

const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    institutionId: { type: String, required: true, unique: true, trim: true },
    cityCode: { type: String, default: 'GEN', trim: true, uppercase: true },
    planType: { type: String, enum: ['trial', 'paid'], default: 'trial' },
    paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    trialTeacherLimit: { type: Number, default: 5 },
    trialSubjectLimitPerTeacher: { type: Number, default: 5 },
    studentLimit: { type: Number, default: 200 },
    subscriptionEndsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const Institution = mongoose.model('Institution', institutionSchema);
