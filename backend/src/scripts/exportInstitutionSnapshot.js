import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb, disconnectDb } from '../config/db.js';
import { Attempt } from '../models/Attempt.js';
import { Institution } from '../models/Institution.js';
import { Message } from '../models/Message.js';
import { Notification } from '../models/Notification.js';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';

function usage() {
  console.log('Usage: node src/scripts/exportInstitutionSnapshot.js <INSTITUTION_ID_CODE> [output.json]');
}

function sanitizeUser(user) {
  const cloned = { ...user };
  delete cloned.passwordHash;
  return cloned;
}

async function run() {
  const institutionIdCode = String(process.argv[2] || '').trim();
  const customOutPath = String(process.argv[3] || '').trim();

  if (!institutionIdCode) {
    usage();
    process.exit(1);
  }

  await connectDb();

  const institution = await Institution.findOne({ institutionId: institutionIdCode }).lean();
  if (!institution) {
    console.error(`Institution not found: ${institutionIdCode}`);
    process.exit(1);
  }

  const institutionObjectId = institution._id;
  const [
    users,
    subjects,
    studentProfiles,
    tests,
    attempts,
    resources,
    messages,
    notifications
  ] = await Promise.all([
    User.find({ institutionId: institutionObjectId }).lean(),
    Subject.find({ institutionId: institutionObjectId }).lean(),
    StudentProfile.find({
      userId: {
        $in: await User.find({ institutionId: institutionObjectId, role: 'student' })
          .distinct('_id')
      }
    }).lean(),
    Test.find({ institutionId: institutionObjectId }).lean(),
    Attempt.find({ institutionId: institutionObjectId }).lean(),
    Resource.find({ institutionId: institutionObjectId }).lean(),
    Message.find({ institutionId: institutionObjectId }).lean(),
    Notification.find({ institutionId: institutionObjectId }).lean()
  ]);

  const snapshot = {
    exportedAt: new Date().toISOString(),
    institutionCode: institutionIdCode,
    institution,
    counts: {
      users: users.length,
      subjects: subjects.length,
      studentProfiles: studentProfiles.length,
      tests: tests.length,
      attempts: attempts.length,
      resources: resources.length,
      messages: messages.length,
      notifications: notifications.length
    },
    users: users.map(sanitizeUser),
    subjects,
    studentProfiles,
    tests,
    attempts,
    resources,
    messages,
    notifications
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultDir = path.resolve(__dirname, '..', '..', '..', 'backups');
  await fs.mkdir(defaultDir, { recursive: true });
  const defaultFile = path.join(
    defaultDir,
    `${institutionIdCode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  const outputPath = customOutPath ? path.resolve(customOutPath) : defaultFile;

  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  await disconnectDb();

  console.log(`Snapshot exported: ${outputPath}`);
}

run().catch(async (error) => {
  console.error('Failed to export institution snapshot:', error.message);
  try {
    await disconnectDb();
  } catch (_error) {
    // ignore secondary disconnect errors
  }
  process.exit(1);
});
