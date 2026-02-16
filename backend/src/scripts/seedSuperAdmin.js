import { connectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { Institution } from '../models/Institution.js';
import { User } from '../models/User.js';

async function seedSuperAdmin() {
  await connectDb();

  let hqInstitution = await Institution.findOne({
    institutionId: env.superAdminInstitutionId
  });

  if (!hqInstitution) {
    hqInstitution = await Institution.create({
      name: 'LIFT HQ',
      institutionId: env.superAdminInstitutionId,
      cityCode: 'HQ',
      planType: 'paid',
      paymentStatus: 'paid',
      trialTeacherLimit: 9999,
      trialSubjectLimitPerTeacher: 9999,
      studentLimit: 999999,
      isActive: true
    });
  }

  const existing = await User.findOne({
    institutionId: hqInstitution._id,
    role: 'super_admin',
    username: env.superAdminUsername.toLowerCase()
  });

  if (existing) {
    console.log('Super admin already exists.');
    process.exit(0);
  }

  const passwordHash = await User.hashPassword(env.superAdminPassword);
  await User.create({
    institutionId: hqInstitution._id,
    role: 'super_admin',
    username: env.superAdminUsername.toLowerCase(),
    passwordHash,
    fullName: 'LIFT Owner',
    email: '',
    phone: '',
    isActive: true
  });

  console.log('Super admin created successfully.');
  console.log(`institutionId: ${env.superAdminInstitutionId}`);
  console.log(`username: ${env.superAdminUsername.toLowerCase()}`);
  console.log(`password: ${env.superAdminPassword}`);
  process.exit(0);
}

seedSuperAdmin().catch((error) => {
  console.error('Failed to seed super admin:', error.message);
  process.exit(1);
});
