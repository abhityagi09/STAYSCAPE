import type { CheckoutConfigDto } from '@stayscape/shared';

/**
 * Razorpay Standard Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
 * Only the publishable key id and the server-created order id reach the browser. The handler's
 * signature is NOT trusted here — it is sent to the API, which verifies it and confirms the payment
 * with Razorpay before anything is confirmed. Card details never touch STAYSCAPE.
 */
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (response: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

function loadScript(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error('Razorpay checkout did not initialise.'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.head.append(script);
  });
  return loading;
}

export async function openRazorpayCheckout(
  config: CheckoutConfigDto,
  callbacks: {
    onAuthorized: (result: {
      providerOrderId: string;
      providerPaymentId: string;
      signature: string;
    }) => void;
    onFailed: (reason: string) => void;
    onDismiss: () => void;
  },
): Promise<void> {
  const Razorpay = await loadScript();
  const instance = new Razorpay({
    key: config.keyId,
    amount: config.amountMinor,
    currency: config.currency,
    name: config.merchantName,
    description: config.description,
    order_id: config.providerOrderId,
    prefill: config.prefill,
    notes: { bookingReference: config.bookingReference },
    theme: { color: '#173D35' },
    handler: (response: RazorpayResponse) =>
      callbacks.onAuthorized({
        providerOrderId: response.razorpay_order_id,
        providerPaymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      }),
    modal: { ondismiss: callbacks.onDismiss, confirm_close: true },
  });
  instance.on('payment.failed', (response) =>
    callbacks.onFailed(response.error?.description ?? 'The payment was declined.'),
  );
  instance.open();
}
