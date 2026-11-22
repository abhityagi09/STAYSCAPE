import type { MailProvider } from '@/infrastructure/mail/mail.provider';
import { renderEmail, type EmailTemplate } from '@/infrastructure/mail/templates';
import type { JobHandler, JobQueue } from '@/infrastructure/queue/job-queue';

export const EMAIL_QUEUE_NAME = 'stayscape-email';

export type EmailJobs = {
  'email.send': EmailTemplate;
};

export type EmailQueue = JobQueue<EmailJobs>;

export function createEmailHandlers(mailer: MailProvider): {
  [K in keyof EmailJobs]: JobHandler<EmailJobs[K]>;
} {
  return {
    'email.send': async (email) => {
      await mailer.send(renderEmail(email));
    },
  };
}
