import type { Logger } from '@/lib/logger';
import {
  hmacHex,
  mapPayment,
  mapRefund,
  parseRazorpayWebhook,
  PaymentProviderError,
  signaturesMatch,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderWebhookEvent,
} from './payment-provider';

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  apiBase: string;
}

/**
 * Razorpay adapter using the official REST API (https://razorpay.com/docs/api/) with HTTP Basic
 * auth. The key secret never leaves the server; the browser only receives the key id and order id.
 *
 * Signatures (official schemes):
 *  - checkout: HMAC-SHA256(order_id + "|" + razorpay_payment_id, key_secret), hex
 *  - webhooks: HMAC-SHA256(raw request body, webhook_secret), hex, header X-Razorpay-Signature
 *
 * NOT VERIFIED against live Razorpay test mode in this repository (requires test keys); see
 * docs/payments.md for the verification checklist.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY' as const;
  readonly sandbox = false;
  readonly publicKeyId: string;

  constructor(
    private readonly config: RazorpayConfig,
    private readonly logger: Logger,
  ) {
    this.publicKeyId = config.keyId;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64');
    let response: Response;
    try {
      response = await fetch(`${this.config.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error({ err: (error as Error).message, path }, 'Razorpay request failed');
      throw new PaymentProviderError(
        'The payment provider could not be reached. Please try again.',
        false,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      let description = response.statusText;
      try {
        description =
          (JSON.parse(text) as { error?: { description?: string } }).error?.description ??
          description;
      } catch {
        /* non-JSON error body */
      }
      this.logger.warn({ status: response.status, path, description }, 'Razorpay request rejected');
      throw new PaymentProviderError(
        `Payment provider error: ${description}`,
        response.status >= 400 && response.status < 500,
      );
    }
    return JSON.parse(text) as T;
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderOrder> {
    const order = await this.request<{
      id: string;
      amount: number;
      currency: string;
      receipt: string | null;
    }>('POST', '/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    });
    return { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt };
  }

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return signaturesMatch(
      hmacHex(this.config.keySecret, `${input.orderId}|${input.paymentId}`),
      input.signature,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signaturesMatch(hmacHex(this.config.webhookSecret, rawBody), signature);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): ProviderWebhookEvent {
    return parseRazorpayWebhook(rawBody, headers);
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    return mapPayment(await this.request('GET', `/payments/${encodeURIComponent(paymentId)}`));
  }

  async fetchOrderPayments(orderId: string): Promise<ProviderPayment[]> {
    const result = await this.request<{ items: Parameters<typeof mapPayment>[0][] }>(
      'GET',
      `/orders/${encodeURIComponent(orderId)}/payments`,
    );
    return result.items.map(mapPayment);
  }

  async capturePayment(
    paymentId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ProviderPayment> {
    return mapPayment(
      await this.request('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, {
        amount: amountMinor,
        currency,
      }),
    );
  }

  async createRefund(input: {
    paymentId: string;
    amountMinor: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderRefund> {
    return mapRefund(
      await this.request('POST', `/payments/${encodeURIComponent(input.paymentId)}/refund`, {
        amount: input.amountMinor,
        speed: 'normal',
        receipt: input.receipt.slice(0, 40),
        notes: input.notes,
      }),
    );
  }

  async fetchRefund(paymentId: string, refundId: string): Promise<ProviderRefund> {
    return mapRefund(
      await this.request(
        'GET',
        `/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`,
      ),
    );
  }

  async listRefunds(paymentId: string): Promise<ProviderRefund[]> {
    const result = await this.request<{ items: Parameters<typeof mapRefund>[0][] }>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    return result.items.map(mapRefund);
  }
}
