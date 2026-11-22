import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * Starts a single-node in-memory MongoDB replica set (transactions supported) for the run.
 * Set MONGO_TEST_URI to use an existing replica set instead (e.g. the Docker one).
 */
export default async function setup(project: TestProject) {
  if (process.env.MONGO_TEST_URI) {
    project.provide('mongoUri', process.env.MONGO_TEST_URI);
    return;
  }
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await replSet.waitUntilRunning();
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
