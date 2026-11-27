import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { bearer, createUserWithRoles, registerUser } from '@/test/helpers';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';

describe('support console', () => {
  it('runs a ticket through assignment, internal notes, a property thread, escalation and resolution', async () => {
    const { app, customer, hotel, owner } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set(bearer(customer.accessToken))
      .field('subject', 'Need an early check-in')
      .field('category', 'BOOKING')
      .field('bookingReference', booking.reference)
      .field('message', 'We land at 6am — can we check in early?')
      .expect(201);
    const ticketId = created.body.data.id as string;
    const agent = await createUserWithRoles(app, ['SUPPORT']);
    const console_ = (path: string) => `/api/v1/admin/support/tickets${path}`;

    // Least privilege: only support:manage holders reach the console.
    await request(app).get(console_('')).set(bearer(customer.accessToken)).expect(403);
    await request(app).get(console_('')).set(bearer(owner.accessToken)).expect(403);

    const queue = (
      await request(app)
        .get(console_('?assignee=unassigned'))
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body.data;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      ticketNumber: created.body.data.ticketNumber,
      priority: 'NORMAL',
      hotel: { id: hotel.hotelId },
      customer: { email: customer.email },
    });

    // Assignment only to people who may work support.
    await request(app)
      .post(console_(`/${ticketId}/assign`))
      .set(bearer(agent.accessToken))
      .send({ assigneeId: customer.id })
      .expect(422);
    const assigned = (
      await request(app)
        .post(console_(`/${ticketId}/assign`))
        .set(bearer(agent.accessToken))
        .send({ assigneeId: agent.id })
        .expect(200)
    ).body.data;
    expect(assigned).toMatchObject({ status: 'IN_PROGRESS', assignee: { id: agent.id } });
    expect(
      (await request(app).get(console_('?assignee=me')).set(bearer(agent.accessToken)).expect(200))
        .body.data.items,
    ).toHaveLength(1);

    await request(app)
      .post(console_(`/${ticketId}/messages`))
      .set(bearer(agent.accessToken))
      .field('channel', 'INTERNAL')
      .field('body', 'Customer is a repeat guest')
      .expect(201);
    // The property thread requires the ticket to be shared first.
    await request(app)
      .post(console_(`/${ticketId}/messages`))
      .set(bearer(agent.accessToken))
      .field('channel', 'PARTNER')
      .field('body', 'Can you do 8am?')
      .expect(409);
    await request(app)
      .get(`/api/v1/partner/support/tickets/${ticketId}`)
      .set(bearer(owner.accessToken))
      .expect(404);
    await request(app)
      .patch(console_(`/${ticketId}`))
      .set(bearer(agent.accessToken))
      .send({ partnerVisible: true })
      .expect(200);
    await request(app)
      .post(console_(`/${ticketId}/messages`))
      .set(bearer(agent.accessToken))
      .field('channel', 'PARTNER')
      .field('body', 'Can you do 8am?')
      .expect(201);

    // Property: sees the ticket, its own thread only, and no customer contact details.
    expect(
      (
        await request(app)
          .get('/api/v1/partner/support/tickets')
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data,
    ).toHaveLength(1);
    const partnerView = (
      await request(app)
        .post(`/api/v1/partner/support/tickets/${ticketId}/messages`)
        .set(bearer(owner.accessToken))
        .field('body', '8am is fine.')
        .expect(201)
    ).body.data;
    expect(partnerView.messages.map((m: { body: string }) => m.body)).toEqual([
      'Can you do 8am?',
      '8am is fine.',
    ]);
    expect(JSON.stringify(partnerView)).not.toContain(customer.email);
    expect(JSON.stringify(partnerView)).not.toContain('repeat guest');
    // Not a partner at all: refused by the partner-workspace gate before any lookup.
    const outsider = await registerUser(app);
    await request(app)
      .get(`/api/v1/partner/support/tickets/${ticketId}`)
      .set(bearer(outsider.accessToken))
      .expect(403);

    // Customer reply from the agent: first response recorded, ball in the customer's court.
    const replied = (
      await request(app)
        .post(console_(`/${ticketId}/messages`))
        .set(bearer(agent.accessToken))
        .field('channel', 'CUSTOMER')
        .field('body', 'Early check-in at 8am is confirmed.')
        .expect(201)
    ).body.data;
    expect(replied.status).toBe('WAITING_FOR_CUSTOMER');
    expect(replied.firstResponseAt).not.toBeNull();
    const customerView = (
      await request(app)
        .get(`/api/v1/support/tickets/${ticketId}`)
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(customerView.messages.map((m: { body: string }) => m.body)).toEqual([
      'We land at 6am — can we check in early?',
      'Early check-in at 8am is confirmed.',
    ]);

    const escalated = (
      await request(app)
        .post(console_(`/${ticketId}/escalate`))
        .set(bearer(agent.accessToken))
        .send({ reason: 'Guest reports wrong room type' })
        .expect(200)
    ).body.data;
    expect(escalated).toMatchObject({ status: 'ESCALATED', escalated: true, priority: 'HIGH' });
    const resolved = (
      await request(app)
        .post(console_(`/${ticketId}/resolve`))
        .set(bearer(agent.accessToken))
        .send({ resolution: 'Upgraded on arrival' })
        .expect(200)
    ).body.data;
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'Upgraded on arrival' });
    await request(app)
      .post(console_(`/${ticketId}/resolve`))
      .set(bearer(agent.accessToken))
      .send({ resolution: 'again' })
      .expect(409);
    expect(resolved.statusHistory.map((h: { status: string }) => h.status)).toEqual([
      'OPEN',
      'IN_PROGRESS',
      'WAITING_FOR_CUSTOMER',
      'ESCALATED',
      'RESOLVED',
    ]);

    const metrics = (
      await request(app)
        .get('/api/v1/admin/support/metrics')
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body.data;
    expect(metrics).toMatchObject({
      created: 1,
      resolved: 1,
      responded: 1,
      escalated: 1,
      averageFirstResponseMinutes: 0,
      byAgent: [{ agentId: agent.id, assigned: 1, resolved: 1 }],
    });

    // A customer reply re-opens a resolved ticket.
    await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set(bearer(customer.accessToken))
      .field('body', 'Actually, one more thing')
      .expect(201);
    expect(
      (
        await request(app)
          .get(console_(`/${ticketId}`))
          .set(bearer(agent.accessToken))
          .expect(200)
      ).body.data,
    ).toMatchObject({ status: 'OPEN', resolvedAt: null });

    const audit = await AuditLogModel.findOne({
      action: 'support.ticket_updated',
      entityId: ticketId,
    }).lean();
    expect(audit?.metadata).toMatchObject({
      before: { partnerVisible: false },
      after: { partnerVisible: true },
    });
    expect(audit?.hotelId?.toString()).toBe(hotel.hotelId);
  });

  it('sorts the queue by priority and filters by status and search', async () => {
    const { app, customer } = await bookingWorld();
    const agent = await createUserWithRoles(app, ['SUPPORT']);
    const ids: string[] = [];
    for (const subject of ['Refund timing', 'Invoice copy', 'Payment failed twice']) {
      const r = await request(app)
        .post('/api/v1/support/tickets')
        .set(bearer(customer.accessToken))
        .field('subject', subject)
        .field('category', 'PAYMENT')
        .field('message', 'Please help with this')
        .expect(201);
      ids.push(r.body.data.id);
    }
    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ids[2]}`)
      .set(bearer(agent.accessToken))
      .send({ priority: 'URGENT' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ids[1]}`)
      .set(bearer(agent.accessToken))
      .send({ priority: 'LOW' })
      .expect(200);
    const sorted = (
      await request(app)
        .get('/api/v1/admin/support/tickets')
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body.data.items;
    expect(sorted.map((t: { subject: string }) => t.subject)).toEqual([
      'Payment failed twice',
      'Refund timing',
      'Invoice copy',
    ]);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/support/tickets?priority=LOW')
          .set(bearer(agent.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/support/tickets?q=invoice')
          .set(bearer(agent.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/support/tickets?status=RESOLVED')
          .set(bearer(agent.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(0);
    // Sharing needs a linked property booking.
    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ids[0]}`)
      .set(bearer(agent.accessToken))
      .send({ partnerVisible: true })
      .expect(422);
  });
});
