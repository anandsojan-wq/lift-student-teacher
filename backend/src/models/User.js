import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Institution',
      required: true
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'teacher', 'student'],
      required: true
    },
    username: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    temporaryPassword: { type: String, default: '', trim: true },
    profileImageUrl: { type: String, default: '' },
    mustChangePassword: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.index({ institutionId: 1, username: 1 }, { unique: true });

userSchema.methods.verifyPassword = function verifyPassword(plainText) {
  return bcrypt.compare(plainText, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plainText) {
  return bcrypt.hash(plainText, 10);
};

export const User = mongoose.model('User', userSchema);
