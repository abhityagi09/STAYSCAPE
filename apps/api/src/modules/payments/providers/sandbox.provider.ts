import { randomBytes } from 'node:crypto';
import { SandboxRecordModel, type SandboxRecordAttrs } from '../payment.models';
import {
  hmacHex,
  parseRazorpayWebhook,
  PaymentProviderError,
  signaturesMatch,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderRefundStatus,
  type ProviderWebhookEvent,
} from './payment-provider';

/**
 * SANDBOX PAYMENT PROVIDER — DEVELOPMENT AND AUTOMATED TESTS ONLY. NO MONEY MOVES.
 *
 * A stateful stand-in for Razorpay test mode that uses the same signature scheme and webhook
 * payload shapes, so the production verification and webhook code paths run unchanged against it.
 * The API refuses to boot with PAYMENT_PROVIDER=sandbox when NODE_ENV=production, and the
 * checkout UI labels it clearly. Behaviour is deterministic and scriptable for failure tests.
 */
export type SandboxRefundBehaviour = 'processed' | 'pending' | 'failed' | 'error';

const id = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'SANDBOX' as const;
  readonly sandbox = true;
  readonly publicKeyId = 'sandbox_key';

  /** Test controls (consumed in order; default behaviour afterwards). */
  readonly controls = {
    refundBehaviours: [] as SandboxRefundBehaviour[],
    captureFailures: 0,
    orderFailures: 0,
  };

  constructor(private readonly secret: string) {}

  private async record(entityId: string): Promise<SandboxRecordAttrs | null> {
    return SandboxRecordModel.findOne({ entityId }).lean<SandboxRecordAttrs>();
  }

  private toPayment(r: SandboxRecordAttrs): ProviderPayment {
    return {
      id: r.entityId,
      orderId: r.orderId,
      amount: r.amount,
      currency: r.currency,
      status: r.status as ProviderPayment['status'],
      errorDescription: (r.notes?.error as string | undefined) ?? null,
    };
  }

  private toRefund(r: SandboxRecordAttrs): ProviderRefund {
    return {
      id: r.entityId,
      paymentId: r.paymentId ?? '',
      amount: r.amount,
      status: r.status as ProviderRefundStatus,
      receipt: r.receipt,
    };
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderOrder> {
    if (this.controls.orderFailures > 0) {
      this.controls.orderFailures -= 1;
      throw new PaymentProviderError('Sandbox: simulated gateway outage', false);
    }
    const orderId = id('order');
    await SandboxRecordModel.create({
      kind: 'ORDER',
      entityId: orderId,
      amount: input.amountMinor,
      currency: input.currency,
      status: 'created',
      receipt: input.receipt,
      notes: input.notes,
    });
    return {
      id: orderId,
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
    };
  }

  signCheckout(orderId: string, paymentId: string): string {
    return hmacHex(this.secret, `${orderId}|${paymentId}`);
  }

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return signaturesMatch(this.signCheckout(input.orderId, input.paymentId), input.signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signaturesMatch(hmacHex(this.secret, rawBody), signature);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): ProviderWebhookEvent {
    return parseRazorpayWebhook(rawBody, headers);
  }

  /** What the hosted checkout would do: the customer pays (or the card is declined). */
  async simulateCheckout(
    orderId: string,
    outcome: 'success' | 'failure',
  ): Promise<{ paymentId: string; signature: string; payment: ProviderPayment }> {
    const order = await this.record(orderId);
    if (!order || order.kind !== 'ORDER')
      throw new PaymentProviderError('Sandbox: unknown order', true);
    const paymentId = id('pay');
    const status = outcome === 'success' ? 'captured' : 'failed';
    await SandboxRecordModel.create({
      kind: 'PAYMENT',
      entityId: paymentId,
      orderId,
      amount: order.amount,
      currency: order.currency,
      status,
      notes: outcome === 'failure' ? { error: 'Sandbox: card declined by issuer' } : {},
    });
    if (outcome === 'success')
      await SandboxRecordModel.updateOne({ entityId: orderId }, { $set: { status: 'paid' } });
    const payment = this.toPayment((await this.record(paymentId))!);
    return { paymentId, signature: this.signCheckout(orderId, paymentId), payment };
  }

  /** Build a signed webhook exactly as Razorpay would deliver it. */
  buildWebhook(
    event: string,
    entity: { payment?: ProviderPayment; refund?: ProviderRefund },
    eventId = id('evt'),
  ): { body: Buffer; signature: string; eventId: string } {
    const payload: Record<string, unknown> = {};
    if (entity.payment) {
      const p = entity.payment;
      payload.payment = {
        entity: {
          id: p.id,
          order_id: p.orderId,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          error_description: p.errorDescription,
        },
      };
    }
    if (entity.refund) {
      const r = entity.refund;
      payload.refund = {
        entity: {
          id: r.id,
          payment_id: r.paymentId,
          amount: r.amount,
          status: r.status,
          receipt: r.receipt,
        },
      };
    }
    const body = Buffer.from(
      JSON.stringify({
        entity: 'event',
        account_id: 'acc_sandbox',
        event,
        contains: Object.keys(payload),
        payload,
        created_at: Math.floor(Date.now() / 1000),
      }),
    );
    return { body, signature: hmacHex(this.secret, body), eventId };
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const r = await this.record(paymentId);
    if (!r || r.kind !== 'PAYMENT')
      throw new PaymentProviderError('Sandbox: unknown payment', true);
    return this.toPayment(r);
  }

  async fetchOrderPayments(orderId: string): Promise<ProviderPayment[]> {
    const rows = await SandboxRecordModel.find({ kind: 'PAYMENT', orderId })
      .sort({ createdAt: 1 })
      .lean<SandboxRecordAttrs[]>();
    return rows.map((r) => this.toPayment(r));
  }

  async capturePayment(
    paymentId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ProviderPayment> {
    if (this.controls.captureFailures > 0) {
      this.controls.captureFailures -= 1;
      throw new PaymentProviderError('Sandbox: simulated capture timeout', false);
    }
    const r = await this.record(paymentId);
    if (!r || r.amount !== amountMinor || r.currency !== currency)
      throw new PaymentProviderError('Sandbox: capture amount mismatch', true);
    if (r.status === 'authorized')
      await SandboxRecordModel.updateOne({ entityId: paymentId }, { $set: { status: 'captured' } });
    return this.fetchPayment(paymentId);
  }

  async createRefund(input: {
    paymentId: string;
    amountMinor: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderRefund> {
    const behaviour = this.controls.refundBehaviours.shift() ?? 'processed';
    const payment = await this.record(input.paymentId);
    if (!payment || payment.status !== 'captured')
      throw new PaymentProviderError('Sandbox: payment is not refundable', true);
    const already = await SandboxRecordModel.find({
      kind: 'REFUND',
      paymentId: input.paymentId,
      status: { $ne: 'failed' },
    }).lean<SandboxRecordAttrs[]>();
    if (already.reduce((s, r) => s + r.amount, 0) + input.amountMinor > payment.amount)
      throw new PaymentProviderError('Sandbox: refund exceeds captured amount', true);
    const refundId = id('rfnd');
    const status: ProviderRefundStatus =
      behaviour === 'failed' ? 'failed' : behaviour === 'pending' ? 'pending' : 'processed';
    await SandboxRecordModel.create({
      kind: 'REFUND',
      entityId: refundId,
      paymentId: input.paymentId,
      amount: input.amountMinor,
      currency: payment.currency,
      status,
      receipt: input.receipt,
      notes: input.notes,
    });
    if (behaviour === 'error') {
      // The refund WAS created but the response was lost — exercises lookup-by-receipt recovery.
      throw new PaymentProviderError('Sandbox: simulated timeout after refund creation', false);
    }
    return this.toRefund((await this.record(refundId))!);
  }

  /** Test helper: settle a pending sandbox refund. */
  async settleRefund(refundId: string, status: 'processed' | 'failed'): Promise<ProviderRefund> {
    await SandboxRecordModel.updateOne(
      { entityId: refundId, kind: 'REFUND' },
      { $set: { status } },
    );
    return this.toRefund((await this.record(refundId))!);
  }

  async fetchRefund(_paymentId: string, refundId: string): Promise<ProviderRefund> {
    const r = await this.record(refundId);
    if (!r || r.kind !== 'REFUND') throw new PaymentProviderError('Sandbox: unknown refund', true);
    return this.toRefund(r);
  }

  async listRefunds(paymentId: string): Promise<ProviderRefund[]> {
    const rows = await SandboxRecordModel.find({ kind: 'REFUND', paymentId }).lean<
      SandboxRecordAttrs[]
    >();
    return rows.map((r) => this.toRefund(r));
  }
}
