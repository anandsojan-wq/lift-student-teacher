import 'dotenv/config';
import mongoose from 'mongoose';
import { Attempt } from '../models/Attempt.js';
import { Test } from '../models/Test.js';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MongoDB connection string not found.');
  }

  await mongoose.connect(uri);

  const [testsResult, attemptsResult] = await Promise.all([
    Test.updateMany({ type: { $in: ['short', 'pdf_upload'] } }, { $set: { type: 'long' } }),
    Attempt.updateMany({ type: { $in: ['short', 'pdf_upload'] } }, { $set: { type: 'long' } })
  ]);

  console.log(
    JSON.stringify(
      {
        testsUpdated: testsResult.modifiedCount || 0,
        attemptsUpdated: attemptsResult.modifiedCount || 0
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    // ignore
  }
  process.exit(1);
});
