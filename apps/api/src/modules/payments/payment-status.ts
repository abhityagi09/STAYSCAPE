import type { ClientSession, Types } from 'mongoose';
import type { PaymentStatus } from '@stayscape/shared';
import { BookingModel } from '@/modules/bookings/booking.models';
import { PaymentModel, type PaymentRecord } from './payment.models';

export const PAID_FAMILY: readonly PaymentStatus[] = [
  'SUCCESS',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

/**
 * A booking's payment status mirrors its primary payment: the earliest payment that captured money,
 * otherwise the most recent attempt. (A duplicate second payment is refunded separately and does not
 * change what the guest paid for the stay.)
 */
export function aggregatePaymentStatus(
  payments: Array<Pick<PaymentRecord, 'status' | 'createdAt'>>,
): PaymentStatus {
  const sorted = [...payments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const paid = sorted.find((p) => PAID_FAMILY.includes(p.status));
  if (paid) return paid.status;
  return sorted[sorted.length - 1]?.status ?? 'INITIATED';
}

export async function syncBookingPaymentStatus(
  bookingId: Types.ObjectId,
  session: ClientSession,
): Promise<PaymentStatus> {
  const payments = await PaymentModel.find(
    { bookingId },
    { status: 1, createdAt: 1 },
    { session },
  ).lean<PaymentRecord[]>();
  const status = aggregatePaymentStatus(payments);
  await BookingModel.updateOne(
    { _id: bookingId },
    { $set: { paymentStatus: status } },
    { session },
  );
  return status;
}
