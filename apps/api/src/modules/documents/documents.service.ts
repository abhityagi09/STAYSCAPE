import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import {
  CURRENCY_EXPONENT,
  MEAL_PLAN_LABELS,
  PAYMENT_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
  type CurrencyCode,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import type { StorageProvider } from '@/infrastructure/storage/storage.provider';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import { nextSequence } from '@/lib/references';
import { CONFIRMED_FAMILY } from '@/modules/bookings/booking.mapper';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import { PartnerModel, type PartnerRecord } from '@/modules/partners/partner.model';
import { PaymentModel, type PaymentRecord } from '@/modules/payments/payment.models';
import { PAID_FAMILY } from '@/modules/payments/payment-status';
import { UserModel } from '@/modules/users/user.model';
import { InvoiceModel, type InvoiceRecord, type PartyDetails } from './invoice.model';

type InvoiceConfig = Pick<
  Config,
  | 'INVOICE_ISSUER_MODE'
  | 'INVOICE_ISSUER_NAME'
  | 'INVOICE_ISSUER_ADDRESS'
  | 'INVOICE_ISSUER_TAX_ID'
  | 'INVOICE_ISSUER_EMAIL'
  | 'INVOICE_NUMBER_PREFIX'
>;

/** Plain-text money for PDFs (the standard PDF fonts have no rupee glyph). */
export function pdfMoney(minor: number, currency: CurrencyCode): string {
  const exp = CURRENCY_EXPONENT[currency] ?? 2;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 10 ** exp);
  const fraction = String(abs % 10 ** exp).padStart(exp, '0');
  return `${sign}${currency} ${major.toLocaleString('en-IN')}.${fraction}`;
}

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: 'STAYSCAPE document', Creator: 'STAYSCAPE' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 84).fill('#173D35');
  doc
    .fillColor('#F8F6F1')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('STAYSCAPE', 48, 30, { characterSpacing: 3 });
  doc.font('Helvetica').fontSize(10).text(subtitle, 48, 54);
  doc.fillColor('#222725').font('Helvetica-Bold').fontSize(16).text(title, 48, 108);
  doc.moveDown(0.5);
}

function rows(doc: PDFKit.PDFDocument, pairs: Array<[string, string]>) {
  for (const [k, v] of pairs) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#6b706d').text(k, 48, y, { width: 150 });
    doc.font('Helvetica').fontSize(10).fillColor('#222725').text(v, 200, y, { width: 347 });
    doc.moveDown(0.35);
  }
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#173D35').text(title, 48);
  doc
    .moveTo(48, doc.y + 2)
    .lineTo(547, doc.y + 2)
    .strokeColor('#E8DFD1')
    .stroke();
  doc.moveDown(0.5);
}

/**
 * Booking documents.
 *  - Invoices are legal records: issued once per paid booking with a gap-tolerant, strictly
 *    increasing number (atomic counter), rendered to PDF and stored in PRIVATE storage.
 *  - Confirmations reflect the booking's current state, so they are rendered on demand.
 * Downloads always go through ownership-checked endpoints; storage keys are never exposed.
 */
export class DocumentsService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly config: InvoiceConfig,
    private readonly logger: Logger,
  ) {}

  private async issuer(
    booking: BookingRecord,
  ): Promise<{ mode: 'PLATFORM' | 'PROPERTY'; details: PartyDetails }> {
    if (this.config.INVOICE_ISSUER_MODE === 'PROPERTY') {
      const partner = await PartnerModel.findById(booking.partnerId).lean<PartnerRecord>();
      const a = partner?.businessAddress ?? {};
      return {
        mode: 'PROPERTY',
        details: {
          name: partner?.businessName ?? booking.hotelSnapshot.name,
          address:
            [a.line1, a.line2, a.city, a.state, a.postalCode, a.country]
              .filter(Boolean)
              .join(', ') || booking.hotelSnapshot.addressLine,
          taxId: partner?.taxDetails?.gstin ?? null,
          email: partner?.contactDetails?.email ?? booking.hotelSnapshot.email,
        },
      };
    }
    return {
      mode: 'PLATFORM',
      details: {
        name: this.config.INVOICE_ISSUER_NAME,
        address: this.config.INVOICE_ISSUER_ADDRESS,
        taxId: this.config.INVOICE_ISSUER_TAX_ID ?? null,
        email: this.config.INVOICE_ISSUER_EMAIL,
      },
    };
  }

  /** Issue the invoice for a paid booking (idempotent: one invoice per booking). */
  async ensureInvoice(bookingId: string): Promise<InvoiceRecord | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;
    const existing = await InvoiceModel.findOne({ bookingId }).lean<InvoiceRecord>();
    if (existing?.documentReference) return existing;
    const booking = await BookingModel.findById(bookingId).lean<BookingRecord>();
    if (!booking || !CONFIRMED_FAMILY.includes(booking.bookingStatus)) return null;
    const payment = await PaymentModel.findOne({
      bookingId: booking._id,
      status: { $in: PAID_FAMILY },
    })
      .sort({ createdAt: 1 })
      .lean<PaymentRecord>();
    if (!payment) return null;

    let invoice = existing;
    if (!invoice) {
      const customer = await UserModel.findById(booking.customerId, {
        firstName: 1,
        lastName: 1,
        email: 1,
      }).lean<{ firstName: string; lastName: string; email: string }>();
      const { mode, details } = await this.issuer(booking);
      const issuedAt = new Date();
      const year = issuedAt.getUTCFullYear();
      const seq = await nextSequence(`invoice-${year}`);
      const price = booking.priceSnapshot;
      const lineItems = booking.bookingItems.map((item) => ({
        description: `${item.roomTypeName} · ${item.ratePlanName} (${MEAL_PLAN_LABELS[item.mealPlan]}) — ${item.rooms} room(s) × ${item.nights.length} night(s), ${booking.checkInLocalDate} to ${booking.checkOutLocalDate}`,
        quantity: item.rooms * item.nights.length,
        unitMinor: Math.round(
          item.price.totals.roomChargesMinor / Math.max(1, item.rooms * item.nights.length),
        ),
        amountMinor: item.price.totals.roomChargesMinor,
      }));
      try {
        const [doc] = await InvoiceModel.create([
          {
            bookingId: booking._id,
            customerId: booking.customerId,
            invoiceNumber: `${this.config.INVOICE_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`,
            issuerMode: mode,
            issuerDetails: details,
            customerDetails: {
              name: customer
                ? `${customer.firstName} ${customer.lastName}`
                : `${booking.guestDetails.primaryGuest.firstName} ${booking.guestDetails.primaryGuest.lastName}`,
              address: '',
              taxId: null,
              email: customer?.email ?? null,
            },
            lineItems,
            taxBreakdown: price.taxes,
            feeBreakdown: price.fees,
            discountMinor: price.totals.discountsMinor,
            totalMinor: price.totals.totalMinor,
            currency: price.currency,
            issuedAt,
          },
        ]);
        invoice = doc!.toObject() as InvoiceRecord;
      } catch (error) {
        // A concurrent generator won; its number is used (ours becomes a documented gap).
        if (!isMongoDuplicateKey(error)) throw error;
        invoice = await InvoiceModel.findOne({ bookingId }).lean<InvoiceRecord>();
        if (!invoice) throw error;
      }
    }
    const pdf = await this.renderInvoice(invoice, booking, payment);
    const key = `invoices/${booking._id}/${invoice.invoiceNumber}.pdf`;
    await this.storage.put(key, pdf, 'application/pdf');
    await InvoiceModel.updateOne({ _id: invoice._id }, { $set: { documentReference: key } });
    this.logger.info({ invoiceNumber: invoice.invoiceNumber }, 'Invoice issued');
    return { ...invoice, documentReference: key };
  }

  private renderInvoice(
    invoice: InvoiceRecord,
    booking: BookingRecord,
    payment: PaymentRecord,
  ): Promise<Buffer> {
    const cur = invoice.currency;
    return render((doc) => {
      header(
        doc,
        `Tax invoice ${invoice.invoiceNumber}`,
        invoice.issuerMode === 'PLATFORM'
          ? 'Issued by the platform as merchant of record'
          : 'Issued on behalf of the property',
      );
      rows(doc, [
        ['Invoice number', invoice.invoiceNumber],
        ['Issue date', invoice.issuedAt.toISOString().slice(0, 10)],
        ['Booking reference', booking.bookingReference],
      ]);
      section(doc, 'Issuer');
      rows(doc, [
        ['Name', invoice.issuerDetails.name],
        ['Address', invoice.issuerDetails.address],
        ['Tax ID', invoice.issuerDetails.taxId ?? '—'],
        ['Email', invoice.issuerDetails.email ?? '—'],
      ]);
      section(doc, 'Billed to');
      rows(doc, [
        ['Name', invoice.customerDetails.name],
        ['Email', invoice.customerDetails.email ?? '—'],
      ]);
      section(doc, 'Stay');
      rows(doc, [
        ['Property', `${booking.hotelSnapshot.name}, ${booking.hotelSnapshot.city}`],
        [
          'Dates',
          `${booking.checkInLocalDate} to ${booking.checkOutLocalDate} (${booking.numberOfNights} night(s))`,
        ],
      ]);
      section(doc, 'Charges');
      rows(doc, [
        ...invoice.lineItems.map((l): [string, string] => [
          l.description,
          pdfMoney(l.amountMinor, cur),
        ]),
        ...(invoice.discountMinor
          ? [['Discounts', pdfMoney(invoice.discountMinor, cur)] as [string, string]]
          : []),
        ...invoice.taxBreakdown.map((t): [string, string] => [
          t.label,
          pdfMoney(t.amountMinor, cur),
        ]),
        ...invoice.feeBreakdown.map((f): [string, string] => [
          f.label,
          pdfMoney(f.amountMinor, cur),
        ]),
      ]);
      doc.moveDown(0.4);
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#222725')
        .text(`Total ${pdfMoney(invoice.totalMinor, cur)}`, 48, doc.y, {
          align: 'right',
          width: 499,
        });
      section(doc, 'Payment');
      rows(doc, [
        ['Status', PAYMENT_STATUS_LABELS[payment.status]],
        ['Method', payment.provider === 'SANDBOX' ? 'Sandbox (test — no money moved)' : 'Razorpay'],
        ['Payment reference', payment.providerPaymentId ?? '—'],
      ]);
      if (payment.provider === 'SANDBOX') {
        doc
          .moveDown(1)
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#9a3412')
          .text(
            'DEVELOPMENT DOCUMENT — generated with the sandbox payment provider. Not a valid tax invoice.',
          );
      }
    });
  }

  private async ownedBooking(customerId: string, reference: string): Promise<BookingRecord> {
    const booking = await BookingModel.findOne({
      bookingReference: reference,
      customerId,
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    return booking;
  }

  async invoicePdf(
    customerId: string,
    reference: string,
  ): Promise<{ body: Buffer; fileName: string }> {
    const booking = await this.ownedBooking(customerId, reference);
    const invoice = await this.ensureInvoice(booking._id.toString());
    if (!invoice?.documentReference) {
      throw new AppError(
        409,
        'NOT_ELIGIBLE',
        'An invoice is available once the booking is confirmed and paid.',
      );
    }
    try {
      return {
        body: await this.storage.get(invoice.documentReference),
        fileName: `${invoice.invoiceNumber}.pdf`,
      };
    } catch (error) {
      // Self-heal a missing file (e.g. lost volume, different worker host): re-render the SAME
      // invoice record — the number and amounts are fixed in the database, never re-issued.
      this.logger.warn(
        { err: (error as Error).message, invoiceNumber: invoice.invoiceNumber },
        'Invoice file missing; regenerating',
      );
      const payment = await PaymentModel.findOne({
        bookingId: booking._id,
        status: { $in: PAID_FAMILY },
      })
        .sort({ createdAt: 1 })
        .lean<PaymentRecord>();
      if (!payment) throw error;
      const pdf = await this.renderInvoice(invoice, booking, payment);
      await this.storage.put(invoice.documentReference, pdf, 'application/pdf');
      return { body: pdf, fileName: `${invoice.invoiceNumber}.pdf` };
    }
  }

  async confirmationPdf(
    customerId: string,
    reference: string,
  ): Promise<{ body: Buffer; fileName: string }> {
    const booking = await this.ownedBooking(customerId, reference);
    if (!CONFIRMED_FAMILY.includes(booking.bookingStatus))
      throw new AppError(
        409,
        'NOT_ELIGIBLE',
        'A confirmation is available for confirmed bookings.',
      );
    const cur = booking.priceSnapshot.currency;
    const g = booking.guestDetails;
    const body = await render((doc) => {
      header(
        doc,
        `Booking confirmation ${booking.bookingReference}`,
        `Status: ${BOOKING_STATUS_LABELS[booking.bookingStatus]} · Payment: ${PAYMENT_STATUS_LABELS[booking.paymentStatus]}`,
      );
      section(doc, 'Property');
      rows(doc, [
        ['Name', booking.hotelSnapshot.name],
        [
          'Address',
          [
            booking.hotelSnapshot.addressLine,
            booking.hotelSnapshot.city,
            booking.hotelSnapshot.state,
            booking.hotelSnapshot.postalCode,
          ]
            .filter(Boolean)
            .join(', '),
        ],
        [
          'Contact',
          [booking.hotelSnapshot.phone, booking.hotelSnapshot.email].filter(Boolean).join(' · ') ||
            '—',
        ],
        ['Check-in', `${booking.checkInLocalDate} from ${booking.hotelSnapshot.checkInTime}`],
        ['Check-out', `${booking.checkOutLocalDate} by ${booking.hotelSnapshot.checkOutTime}`],
      ]);
      section(doc, 'Guests');
      rows(doc, [
        ['Primary guest', `${g.primaryGuest.firstName} ${g.primaryGuest.lastName}`],
        ['Contact', `${g.primaryGuest.email} · ${g.primaryGuest.phone}`],
        ...(g.additionalGuests.length
          ? [
              [
                'Other guests',
                g.additionalGuests.map((x) => `${x.firstName} ${x.lastName}`).join(', '),
              ] as [string, string],
            ]
          : []),
        ['Total guests', String(booking.totalGuests)],
        ...(g.specialRequests ? [['Special requests', g.specialRequests] as [string, string]] : []),
      ]);
      section(doc, 'Rooms');
      rows(
        doc,
        booking.bookingItems.map((i): [string, string] => [
          `${i.rooms} × ${i.roomTypeName}`,
          `${i.ratePlanName} · ${MEAL_PLAN_LABELS[i.mealPlan]} · ${i.adults} adult(s)${i.children ? `, ${i.children} child(ren)` : ''}`,
        ]),
      );
      section(doc, 'Price');
      rows(doc, [
        ['Room charges', pdfMoney(booking.priceSnapshot.totals.roomChargesMinor, cur)],
        ...(booking.priceSnapshot.totals.discountsMinor
          ? [
              ['Discounts', pdfMoney(booking.priceSnapshot.totals.discountsMinor, cur)] as [
                string,
                string,
              ],
            ]
          : []),
        ...booking.priceSnapshot.taxes.map((t): [string, string] => [
          t.label,
          pdfMoney(t.amountMinor, cur),
        ]),
        ...booking.priceSnapshot.fees.map((f): [string, string] => [
          f.label,
          pdfMoney(f.amountMinor, cur),
        ]),
        ['Total', pdfMoney(booking.priceSnapshot.totals.totalMinor, cur)],
      ]);
      section(doc, 'Cancellation policy');
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#222725')
        .text(booking.cancellationPolicySnapshot.map((p) => p.summary).join(' '), 48, doc.y, {
          width: 499,
        });
    });
    return { body, fileName: `${booking.bookingReference}-confirmation.pdf` };
  }
}
