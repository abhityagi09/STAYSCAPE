import type { MailMessage } from './mail.provider';
import { button, escapeHtml, layout } from './templates';

/**
 * Transactional reservation emails. Each template is a pure function of its data so it can be
 * unit-tested and previewed; all interpolated values are HTML-escaped.
 */
export const BOOKING_EMAIL_TEMPLATES = [
  'booking-created',
  'payment-succeeded',
  'payment-failed',
  'booking-confirmed',
  'booking-cancelled',
  'booking-expired',
  'booking-under-review',
  'refund-requested',
  'refund-completed',
  'refund-failed',
  'checkin-reminder',
  'review-reminder',
  'operations-alert',
] as const;
export type BookingEmailTemplate = (typeof BOOKING_EMAIL_TEMPLATES)[number];

export interface BookingEmailData {
  firstName: string;
  reference: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomSummary: string;
  amount: string;
  link: string;
  /** Template-specific extra lines (already formatted, e.g. refund amount, failure reason). */
  extra?: Record<string, string>;
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  details: Array<[string, string]>;
  outro?: string;
}

function copy(template: BookingEmailTemplate, d: BookingEmailData): Copy {
  const stay: Array<[string, string]> = [
    ['Booking reference', d.reference],
    ['Property', d.hotelName],
    ['Stay', `${d.checkIn} → ${d.checkOut} (${d.nights} night${d.nights === 1 ? '' : 's'})`],
    ['Rooms', d.roomSummary],
  ];
  const x = d.extra ?? {};
  switch (template) {
    case 'booking-created':
      return {
        subject: `Complete your booking ${d.reference}`,
        heading: 'Your rooms are on hold',
        intro: `Complete payment of ${d.amount} to confirm your stay at ${d.hotelName}. The hold is released automatically if payment is not completed in time.`,
        cta: 'Complete payment',
        details: stay,
      };
    case 'payment-succeeded':
      return {
        subject: `Payment received for ${d.reference}`,
        heading: 'Payment received',
        intro: `We received your payment of ${d.amount}.`,
        cta: 'View booking',
        details: [...stay, ['Amount paid', d.amount]],
      };
    case 'payment-failed':
      return {
        subject: `Payment did not go through for ${d.reference}`,
        heading: 'Your payment failed',
        intro: `Your payment could not be completed${x.reason ? `: ${x.reason}` : ''}. No money was taken. You can try again while your rooms are still held.`,
        cta: 'Try again',
        details: stay,
      };
    case 'booking-confirmed':
      return {
        subject: `Booking confirmed: ${d.hotelName} (${d.reference})`,
        heading: 'Your stay is confirmed',
        intro: `Your booking at ${d.hotelName} is confirmed. Your confirmation and invoice can be downloaded from your account.`,
        cta: 'View booking',
        details: [...stay, ['Total paid', d.amount], ['Cancellation policy', x.policy ?? '']],
        outro: 'Have a wonderful stay.',
      };
    case 'booking-cancelled':
      return {
        subject: `Booking ${d.reference} cancelled`,
        heading: 'Your booking was cancelled',
        intro: x.refund
          ? `Your booking was cancelled. ${x.refund} will be refunded to your original payment method.`
          : 'Your booking was cancelled. No refund is due under the booking’s cancellation policy.',
        cta: 'View booking',
        details: [...stay, ['Cancellation charge', x.charge ?? '—']],
      };
    case 'booking-expired':
      return {
        subject: `Booking ${d.reference} expired`,
        heading: 'Your booking expired',
        intro: 'Payment was not completed in time, so the rooms were released. No money was taken.',
        cta: 'Search again',
        details: stay,
      };
    case 'booking-under-review':
      return {
        subject: `We are refunding booking ${d.reference}`,
        heading: 'Your payment is being refunded',
        intro: `Your payment of ${d.amount} arrived after your room hold expired and the rooms were no longer available. We have started a full refund. We are sorry for the inconvenience.`,
        cta: 'View booking',
        details: stay,
      };
    case 'refund-requested':
      return {
        subject: `Refund started for ${d.reference}`,
        heading: 'Your refund is on its way',
        intro: `A refund of ${x.refund ?? d.amount} has been started. Banks usually take 5–7 working days to show it.`,
        cta: 'Track refund',
        details: stay,
      };
    case 'refund-completed':
      return {
        subject: `Refund completed for ${d.reference}`,
        heading: 'Your refund is complete',
        intro: `The payment provider confirmed your refund of ${x.refund ?? d.amount}.`,
        cta: 'View booking',
        details: stay,
      };
    case 'refund-failed':
      return {
        subject: `Update on your refund for ${d.reference}`,
        heading: 'Your refund needs attention',
        intro:
          'The payment provider could not complete your refund. Our team has been notified and will resolve it — you do not need to do anything.',
        cta: 'View booking',
        details: stay,
      };
    case 'checkin-reminder':
      return {
        subject: `Your stay at ${d.hotelName} starts tomorrow`,
        heading: 'See you tomorrow',
        intro: `Check-in is from ${x.checkInTime ?? 'the property’s check-in time'}. ${x.address ? `Address: ${x.address}.` : ''}`,
        cta: 'View booking',
        details: stay,
      };
    case 'review-reminder':
      return {
        subject: `How was ${d.hotelName}?`,
        heading: 'Tell other travellers about your stay',
        intro: 'Your verified review helps other guests and the property. It takes two minutes.',
        cta: 'Write a review',
        details: stay,
      };
    case 'operations-alert':
      return {
        subject: `[STAYSCAPE ops] ${x.alert ?? 'Attention required'} — ${d.reference}`,
        heading: x.alert ?? 'Attention required',
        intro: x.detail ?? '',
        cta: 'Open operations',
        details: stay,
      };
  }
}

export function renderBookingEmail(
  template: BookingEmailTemplate,
  to: string,
  data: BookingEmailData,
): MailMessage {
  const c = copy(template, data);
  const rows = c.details
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6b706d;font-size:13px;width:40%">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const html = layout(
    c.heading,
    `<p>Hi ${escapeHtml(data.firstName)},</p><p>${escapeHtml(c.intro)}</p><table role="presentation" width="100%" style="margin:16px 0;border-top:1px solid #E8DFD1;border-bottom:1px solid #E8DFD1">${rows}</table>${button(data.link, c.cta)}${c.outro ? `<p>${escapeHtml(c.outro)}</p>` : ''}`,
  );
  const text = [
    `Hi ${data.firstName},`,
    '',
    c.intro,
    '',
    ...c.details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    '',
    `${c.cta}: ${data.link}`,
    ...(c.outro ? ['', c.outro] : []),
  ].join('\n');
  return { to, subject: c.subject, html, text };
}
