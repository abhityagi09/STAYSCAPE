import type { MailMessage } from './mail.provider';

export type EmailTemplate =
  | {
      template: 'email-verification';
      to: string;
      data: { firstName: string; link: string; expiresInHours: number };
    }
  | {
      template: 'password-reset';
      to: string;
      data: { firstName: string; link: string; expiresInMinutes: number };
    }
  | { template: 'password-changed'; to: string; data: { firstName: string; supportUrl: string } };

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F8F6F1;font-family:Inter,Segoe UI,Arial,sans-serif;color:#222725">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #E8DFD1">
<tr><td style="padding:28px 32px;background:#173D35;border-radius:16px 16px 0 0;color:#F8F6F1;font-size:20px;letter-spacing:.2em;font-weight:600">STAYSCAPE</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 32px 28px;color:#6b706d;font-size:12px">You received this email because of activity on your STAYSCAPE account.</td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#173D35;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#6b706d">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;

export function renderEmail(email: EmailTemplate): MailMessage {
  switch (email.template) {
    case 'email-verification': {
      const { firstName, link, expiresInHours } = email.data;
      return {
        to: email.to,
        subject: 'Verify your STAYSCAPE email address',
        text: `Hi ${firstName},\n\nConfirm your email address by opening this link:\n${link}\n\nThe link expires in ${expiresInHours} hours. If you did not create an account, you can ignore this email.`,
        html: layout(
          'Confirm your email address',
          `<p>Hi ${escapeHtml(firstName)},</p><p>Welcome to STAYSCAPE. Confirm your email address to secure your account.</p>${button(link, 'Verify email')}<p style="font-size:13px">This link expires in ${expiresInHours} hours.</p>`,
        ),
      };
    }
    case 'password-reset': {
      const { firstName, link, expiresInMinutes } = email.data;
      return {
        to: email.to,
        subject: 'Reset your STAYSCAPE password',
        text: `Hi ${firstName},\n\nReset your password using this link:\n${link}\n\nThe link expires in ${expiresInMinutes} minutes and can only be used once. If you did not request a reset, ignore this email — your password is unchanged.`,
        html: layout(
          'Reset your password',
          `<p>Hi ${escapeHtml(firstName)},</p><p>We received a request to reset your password.</p>${button(link, 'Choose a new password')}<p style="font-size:13px">This link expires in ${expiresInMinutes} minutes and can be used once. If you did not request this, you can safely ignore this email.</p>`,
        ),
      };
    }
    case 'password-changed': {
      const { firstName, supportUrl } = email.data;
      return {
        to: email.to,
        subject: 'Your STAYSCAPE password was changed',
        text: `Hi ${firstName},\n\nThe password for your account was just changed and other sessions were signed out. If this was not you, contact support immediately: ${supportUrl}`,
        html: layout(
          'Your password was changed',
          `<p>Hi ${escapeHtml(firstName)},</p><p>The password for your account was just changed and your other sessions were signed out.</p><p>If this was not you, <a href="${escapeHtml(supportUrl)}">contact support</a> immediately.</p>`,
        ),
      };
    }
  }
}
