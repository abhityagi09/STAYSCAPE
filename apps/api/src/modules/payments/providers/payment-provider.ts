import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProviderName } from '@stayscape/shared';
import { AppError } from '@/lib/errors';

/**
 * Gateway abstraction. Amounts are integer minor units. Statuses follow Razorpay's vocabulary
 * (the first concrete provider); another gateway (e.g. Stripe) maps its own states onto these.
 */
export interface ProviderOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
}

export type ProviderPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
export interface ProviderPayment {
  id: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: ProviderPaymentStatus;
  errorDescription: string | null;
}

export type ProviderRefundStatus = 'pending' | 'processed' | 'failed';
export interface ProviderRefund {
  id: string;
  paymentId: string;
  amount: number;
  status: ProviderRefundStatus;
  receipt: string | null;
}

/** A verified webhook, normalised. */
export interface ProviderWebhookEvent {
  eventId: string;
  eventType: string;
  payment: ProviderPayment | null;
  refund: ProviderRefund | null;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Publishable key for browser checkout (never a secret). */
  readonly publicKeyId: string | null;
  readonly sandbox: boolean;
  createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderOrder>;
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): ProviderWebhookEvent;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  fetchOrderPayments(orderId: string): Promise<ProviderPayment[]>;
  capturePayment(
    paymentId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ProviderPayment>;
  createRefund(input: {
    paymentId: string;
    amountMinor: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderRefund>;
  fetchRefund(paymentId: string, refundId: string): Promise<ProviderRefund>;
  listRefunds(paymentId: string): Promise<ProviderRefund[]>;
}

export class PaymentProviderError extends AppError {
  constructor(
    message: string,
    /** Definitive rejection (4xx from the gateway) vs. transient/unknown outcome. */
    public readonly definitive: boolean,
  ) {
    super(502, 'PAYMENT_PROVIDER_ERROR', message);
  }
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison of hex signatures. */
export function signaturesMatch(expectedHex: string, provided: string | undefined): boolean {
  if (!provided || !/^[a-f0-9]+$/i.test(provided)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- Razorpay payload mapping
interface RazorpayPaymentEntity {
  id: string;
  order_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  error_description?: string | null;
}
interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  receipt?: string | null;
}

export function mapPayment(entity: RazorpayPaymentEntity): ProviderPayment {
  const known: ProviderPaymentStatus[] = [
    'created',
    'authorized',
    'captured',
    'failed',
    'refunded',
  ];
  return {
    id: entity.id,
    orderId: entity.order_id ?? null,
    amount: entity.amount,
    currency: entity.currency,
    status: (known.includes(entity.status as ProviderPaymentStatus)
      ? entity.status
      : 'created') as ProviderPaymentStatus,
    errorDescription: entity.error_description ?? null,
  };
}

export function mapRefund(entity: RazorpayRefundEntity): ProviderRefund {
  const status: ProviderRefundStatus =
    entity.status === 'processed' ? 'processed' : entity.status === 'failed' ? 'failed' : 'pending';
  return {
    id: entity.id,
    paymentId: entity.payment_id,
    amount: entity.amount,
    status,
    receipt: entity.receipt ?? null,
  };
}

/** Razorpay webhook body → normalised event (shared by the real and sandbox providers). */
export function parseRazorpayWebhook(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
): ProviderWebhookEvent {
  let body: {
    event?: string;
    payload?: {
      payment?: { entity?: RazorpayPaymentEntity };
      refund?: { entity?: RazorpayRefundEntity };
    };
  };
  try {
    body = JSON.parse(rawBody.toString('utf8')) as typeof body;
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Webhook body is not valid JSON.');
  }
  const eventId = headers['x-razorpay-event-id'];
  if (!eventId || !/^[A-Za-z0-9_\-.]{4,128}$/.test(eventId))
    throw new AppError(400, 'BAD_REQUEST', 'Webhook event id is missing.');
  if (!body.event) throw new AppError(400, 'BAD_REQUEST', 'Webhook event type is missing.');
  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  return {
    eventId,
    eventType: body.event,
    payment: payment ? mapPayment(payment) : null,
    refund: refund ? mapRefund(refund) : null,
  };
}
