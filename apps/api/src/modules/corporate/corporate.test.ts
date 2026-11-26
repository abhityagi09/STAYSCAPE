import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, registerUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';
import { evaluatePolicy } from './corporate.service';

const base = {
  maxNightlyMinor: null,
  maxStarCategory: null,
  allowedCities: [],
  minAdvanceDays: 0,
  approvalRequiredAboveMinor: null,
  monthlyBudgetMinor: null,
};

describe('travel policy', () => {
  it('flags each rule and requires approval for violations or large trips', () => {
    const trip = {
      nightlyMinor: 500_000,
      totalMinor: 1_050_000,
      stars: 4,
      city: 'Udaipur',
      advanceDays: 10,
      committedThisMonthMinor: 0,
    };
    expect(evaluatePolicy(base, trip)).toEqual({ violations: [], status: 'AUTO_APPROVED' });
    expect(
      evaluatePolicy(
        {
          ...base,
          maxNightlyMinor: 400_000,
          maxStarCategory: 3,
          allowedCities: ['Delhi'],
          minAdvanceDays: 14,
          monthlyBudgetMinor: 1_000_000,
        },
        trip,
      ).violations,
    ).toEqual([
      'NIGHTLY_RATE_ABOVE_LIMIT',
      'STAR_CATEGORY_ABOVE_LIMIT',
      'CITY_NOT_ALLOWED',
      'BOOKED_TOO_LATE',
      'OVER_MONTHLY_BUDGET',
    ]);
    expect(evaluatePolicy({ ...base, approvalRequiredAboveMinor: 1_000_000 }, trip)).toEqual({
      violations: [],
      status: 'PENDING',
    });
  });
});

describe('corporate travel', () => {
  it('verifies the organisation, applies policy, routes approvals and isolates data', async () => {
    const { app, admin, customer: employee, hotel } = await bookingWorld();
    const orgAdmin = await registerUser(app);
    const approver = await registerUser(app);
    const outsider = await registerUser(app);

    await request(app)
      .post('/api/v1/corporate/organizations')
      .set(bearer(orgAdmin.accessToken))
      .send({
        name: 'Acme Travel Pvt Ltd',
        billingEmail: 'finance@acme.example',
        gstin: '27AAACA1234A1Z5',
      })
      .expect(201);
    const org = (
      await request(app)
        .get('/api/v1/corporate/organization')
        .set(bearer(orgAdmin.accessToken))
        .expect(200)
    ).body.data;
    expect(org).toMatchObject({ status: 'PENDING_VERIFICATION', myRole: 'ORG_ADMIN' });
    // Nothing operational until Stayscape verifies the business.
    await request(app)
      .post('/api/v1/corporate/invitations')
      .set(bearer(orgAdmin.accessToken))
      .send({ email: employee.email })
      .expect(409);
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/decision`)
      .set(bearer(orgAdmin.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(403);
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(200);

    for (const [user, role, department] of [
      [employee, 'EMPLOYEE', 'Sales'],
      [approver, 'APPROVER', 'Finance'],
    ] as const) {
      const { token } = (
        await request(app)
          .post('/api/v1/corporate/invitations')
          .set(bearer(orgAdmin.accessToken))
          .send({ email: user.email, role, department })
          .expect(201)
      ).body.data;
      await request(app)
        .post('/api/v1/corporate/invitations/accept')
        .set(bearer(user.accessToken))
        .send({ token })
        .expect(200);
    }
    await request(app)
      .put('/api/v1/corporate/organization/policy')
      .set(bearer(employee.accessToken))
      .send(base)
      .expect(403);
    await request(app)
      .put('/api/v1/corporate/organization/policy')
      .set(bearer(orgAdmin.accessToken))
      .send({ ...base, maxNightlyMinor: 450_000 })
      .expect(200);

    const trip = {
      hotelId: hotel.hotelId,
      roomTypeId: hotel.roomTypeId,
      ratePlanId: hotel.ratePlanId,
      checkIn: daysFromToday(10),
      checkOut: daysFromToday(12),
      adults: 1,
      purpose: 'Client workshop in Udaipur',
    };
    const req1 = (
      await request(app)
        .post('/api/v1/corporate/requests')
        .set(bearer(employee.accessToken))
        .send(trip)
        .expect(201)
    ).body.data;
    // ₹5,000/night quoted by the engine exceeds the ₹4,500 cap → needs approval.
    expect(req1).toMatchObject({
      status: 'PENDING',
      nightlyMinor: 500_000,
      quotedTotalMinor: 1_050_000,
      violations: ['NIGHTLY_RATE_ABOVE_LIMIT'],
    });
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/booking`)
      .set(bearer(employee.accessToken))
      .send({ bookingReference: 'SS-AAAAAAAA' })
      .expect(409);
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/decision`)
      .set(bearer(employee.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(403);
    await request(app)
      .get('/api/v1/corporate/requests?scope=org')
      .set(bearer(employee.accessToken))
      .expect(403);
    expect(
      (
        await request(app)
          .get('/api/v1/corporate/requests?scope=org&status=PENDING')
          .set(bearer(approver.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/decision`)
      .set(bearer(approver.accessToken))
      .send({ decision: 'APPROVE', note: 'Client-facing, approved' })
      .expect(200);
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/decision`)
      .set(bearer(approver.accessToken))
      .send({ decision: 'REJECT', note: 'changed mind' })
      .expect(409);

    // The employee books normally and links the booking; it must match the approved stay.
    const wrong = await holdAndBook(app, employee, hotel, [20, 21]);
    await payInFull(app, employee, wrong.booking.reference);
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/booking`)
      .set(bearer(employee.accessToken))
      .send({ bookingReference: wrong.booking.reference })
      .expect(422);
    const { booking } = await holdAndBook(app, employee, hotel, [10, 12]);
    await payInFull(app, employee, booking.reference);
    const linked = (
      await request(app)
        .post(`/api/v1/corporate/requests/${req1.id}/booking`)
        .set(bearer(employee.accessToken))
        .send({ bookingReference: booking.reference })
        .expect(200)
    ).body.data;
    expect(linked.status).toBe('BOOKED');

    const report = (
      await request(app)
        .get(`/api/v1/corporate/reports?from=${daysFromToday(0)}&to=${daysFromToday(30)}`)
        .set(bearer(orgAdmin.accessToken))
        .expect(200)
    ).body.data;
    expect(report).toMatchObject({
      spendMinor: 1_050_000,
      requests: { total: 1, booked: 1 },
      inPolicyRateBp: 0,
      byDepartment: [{ department: 'Sales', spendMinor: 1_050_000, bookings: 1 }],
    });
    const invoices = (
      await request(app)
        .get('/api/v1/corporate/invoices')
        .set(bearer(orgAdmin.accessToken))
        .expect(200)
    ).body.data;
    expect(invoices).toEqual([
      expect.objectContaining({ bookingReference: booking.reference, totalMinor: 1_050_000 }),
    ]);
    const pdf = await request(app)
      .get(`/api/v1/corporate/invoices/${booking.reference}`)
      .set(bearer(orgAdmin.accessToken))
      .expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    // The unlinked personal booking is not visible to the employer.
    await request(app)
      .get(`/api/v1/corporate/invoices/${wrong.booking.reference}`)
      .set(bearer(orgAdmin.accessToken))
      .expect(404);

    // Isolation: someone outside the organisation sees nothing.
    await request(app)
      .get('/api/v1/corporate/organization')
      .set(bearer(outsider.accessToken))
      .expect(404);
    await request(app)
      .post(`/api/v1/corporate/requests/${req1.id}/decision`)
      .set(bearer(outsider.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(404);
    await request(app)
      .post('/api/v1/corporate/organizations')
      .set(bearer(employee.accessToken))
      .send({ name: 'Side Co', billingEmail: 'x@side.example' })
      .expect(409);
  });
});
