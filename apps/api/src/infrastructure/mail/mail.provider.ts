import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '@/config/env';
import type { Logger } from '@/lib/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<{ messageId: string }>;
  verify?(): Promise<void>;
}

/** Real SMTP delivery. In local development this points to Mailpit (captures mail, sends nothing). */
export class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(private readonly config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } }
        : {}),
    });
  }

  async send(message: MailMessage) {
    const info = await this.transporter.sendMail({ from: this.config.MAIL_FROM, ...message });
    return { messageId: String(info.messageId) };
  }

  async verify() {
    await this.transporter.verify();
  }
}

/**
 * DEVELOPMENT ONLY: writes messages to the log instead of delivering them.
 * Env validation forbids this provider in production.
 */
export class LogMailProvider implements MailProvider {
  readonly name = 'log';
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage) {
    this.logger.warn(
      { to: message.to, subject: message.subject, text: message.text },
      '[dev mail] message not delivered',
    );
    return { messageId: `log-${Date.now()}` };
  }
}

/** TEST ONLY: captures messages in memory so tests can read links out of them. */
export class MemoryMailProvider implements MailProvider {
  readonly name = 'memory';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage) {
    this.sent.push(message);
    return { messageId: `memory-${this.sent.length}` };
  }

  lastTo(address: string): MailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === address);
  }

  clear() {
    this.sent.length = 0;
  }
}

export function createMailProvider(config: Config, logger: Logger): MailProvider {
  switch (config.MAIL_PROVIDER) {
    case 'smtp':
      return new SmtpMailProvider(config);
    case 'log':
      return new LogMailProvider(logger);
    case 'memory':
      return new MemoryMailProvider();
  }
}
