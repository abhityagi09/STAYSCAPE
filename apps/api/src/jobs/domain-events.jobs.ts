import type { JobHandler } from '@/infrastructure/queue/job-queue';
import type { DocumentsService } from '@/modules/documents/documents.service';
import type { BookingNotificationsService } from '@/modules/notifications/booking-notifications.service';
import {
  DOMAIN_EVENT_TYPES,
  type DomainEvent,
  type DomainEventJobs,
} from '@/modules/outbox/outbox.service';
import type { RefundsService } from '@/modules/payments/refunds.service';

/**
 * Handlers for events dispatched from the transactional outbox. Each is idempotent: notification
 * deliveries are de-duplicated per recipient/channel, refund processing claims the refund
 * atomically, and invoices are unique per booking.
 */
export function createDomainEventHandlers(deps: {
  notifications: BookingNotificationsService;
  refunds: RefundsService;
  documents: DocumentsService;
}): { [K in keyof DomainEventJobs]: JobHandler<DomainEvent> } {
  const notify: JobHandler<DomainEvent> = (event) => deps.notifications.handle(event);
  const handlers = Object.fromEntries(DOMAIN_EVENT_TYPES.map((type) => [type, notify])) as {
    [K in keyof DomainEventJobs]: JobHandler<DomainEvent>;
  };
  handlers['refund.process'] = async (event) => {
    await deps.refunds.process(event.aggregateId);
  };
  handlers['documents.generate'] = async (event) => {
    await deps.documents.ensureInvoice(event.aggregateId);
  };
  return handlers;
}
