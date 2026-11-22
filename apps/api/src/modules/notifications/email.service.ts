import type { Config } from '@/config/env';
import type { EmailQueue } from '@/jobs/email.jobs';

/** Builds transactional emails and hands them to the job queue (never sends inline). */
export class EmailService {
  constructor(
    private readonly queue: EmailQueue,
    private readonly config: Pick<
      Config,
      'WEB_APP_URL' | 'EMAIL_VERIFICATION_TTL_HOURS' | 'PASSWORD_RESET_TTL_MINUTES'
    >,
  ) {}

  private link(path: string, token: string) {
    const url = new URL(path, this.config.WEB_APP_URL);
    url.searchParams.set('token', token);
    return url.toString();
  }

  sendEmailVerification(params: { to: string; firstName: string; token: string; tokenId: string }) {
    return this.queue.enqueue(
      'email.send',
      {
        template: 'email-verification',
        to: params.to,
        data: {
          firstName: params.firstName,
          link: this.link('/verify-email', params.token),
          expiresInHours: this.config.EMAIL_VERIFICATION_TTL_HOURS,
        },
      },
      { jobId: `email-verification-${params.tokenId}` },
    );
  }

  sendPasswordReset(params: { to: string; firstName: string; token: string; tokenId: string }) {
    return this.queue.enqueue(
      'email.send',
      {
        template: 'password-reset',
        to: params.to,
        data: {
          firstName: params.firstName,
          link: this.link('/reset-password', params.token),
          expiresInMinutes: this.config.PASSWORD_RESET_TTL_MINUTES,
        },
      },
      { jobId: `password-reset-${params.tokenId}` },
    );
  }

  sendPasswordChanged(params: { to: string; firstName: string; eventId: string }) {
    return this.queue.enqueue(
      'email.send',
      {
        template: 'password-changed',
        to: params.to,
        data: {
          firstName: params.firstName,
          supportUrl: new URL('/privacy', this.config.WEB_APP_URL).toString(),
        },
      },
      { jobId: `password-changed-${params.eventId}` },
    );
  }
}
