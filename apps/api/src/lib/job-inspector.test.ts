import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE_NAME } from '@/jobs/email.jobs';
import { bearer, createTestContext, createUserWithRoles } from '@/test/helpers';
import { JobInspector } from './job-inspector';

/** Uses a real Redis when REDIS_TEST_URL is set (CI service / local Docker, db 15). */
const url = process.env.REDIS_TEST_URL;
const redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;
afterAll(async () => {
  await redis?.quit();
});

describe('job inspector', () => {
  it('answers 503 when queues are not configured', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['SUPER_ADMIN']);
    await request(app)
      .get('/api/v1/admin/operations/jobs')
      .set(bearer(admin.accessToken))
      .expect(503);
  });

  it.runIf(redis)('lists dead-lettered jobs without payloads and retries them', async () => {
    await redis!.flushdb();
    const connection = redis as unknown as ConnectionOptions;
    const queue = new Queue(EMAIL_QUEUE_NAME, { connection });
    let fail = true;
    const worker = new Worker(
      EMAIL_QUEUE_NAME,
      async () => {
        if (fail) throw new Error('SMTP unavailable');
      },
      { connection: redis!.duplicate() as unknown as ConnectionOptions },
    );
    const failed = new Promise((resolve) => worker.once('failed', resolve));
    await queue.add(
      'send',
      { to: 'secret@example.com', link: 'https://one-time' },
      { attempts: 1 },
    );
    await failed;

    const inspector = new JobInspector(redis);
    const overview = await inspector.overview();
    const email = overview.find((q) => q.queue === EMAIL_QUEUE_NAME)!;
    expect(email.counts.failed).toBe(1);
    expect(email.failed[0]).toMatchObject({
      name: 'send',
      failedReason: 'SMTP unavailable',
      attemptsMade: 1,
    });
    expect(JSON.stringify(overview)).not.toMatch(/secret@example\.com|one-time/);

    fail = false;
    const completed = new Promise((resolve) => worker.once('completed', resolve));
    await inspector.retry(EMAIL_QUEUE_NAME, email.failed[0]!.id);
    await completed;
    expect(
      (await inspector.overview()).find((q) => q.queue === EMAIL_QUEUE_NAME)!.counts.failed,
    ).toBe(0);
    await expect(inspector.retry(EMAIL_QUEUE_NAME, email.failed[0]!.id)).rejects.toThrow(
      /Job not found|Only failed/,
    );

    await worker.close();
    await queue.close();
    await inspector.close();
  });
});
