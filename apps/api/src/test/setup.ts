import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { ALL_MODELS } from '@/infrastructure/models';

const dbName = `stayscape_test_${process.env.VITEST_POOL_ID ?? '0'}_${process.pid}`;

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName, autoIndex: true });
  // Unique and TTL indexes must exist for the behaviour under test.
  await Promise.all(
    ALL_MODELS.map((model) => model.createCollection().then(() => model.syncIndexes())),
  );
});

beforeEach(async () => {
  await Promise.all(ALL_MODELS.map((model) => model.collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});
