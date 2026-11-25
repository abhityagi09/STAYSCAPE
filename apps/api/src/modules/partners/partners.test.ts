import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PartnerModel } from './partner.model';
import { UserModel } from '@/modules/users/user.model';
import { bearer, createTestContext, registerUser } from '@/test/helpers';
import { PDF, completeApplication, createAdmin, uploadDoc } from '@/test/marketplace-fixtures';

describe('partner onboarding', () => {
  it('saves drafts, validates sections and restores the application', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    expect(
      (
        await request(app)
          .get('/api/v1/partner/application')
          .set(bearer(user.accessToken))
          .expect(200)
      ).body.data,
    ).toBeNull();

    const draft = await request(app)
      .put('/api/v1/partner/application')
      .set(bearer(user.accessToken))
      .send({ business: { businessName: 'Lakeview' } })
      .expect(200);
    expect(draft.body.data.verificationStatus).toBe('REGISTERED');
    expect(draft.body.data.missingRequirements).toEqual(
      expect.arrayContaining(['Settlement bank account', 'Identity proof of authorised signatory']),
    );

    const bad = await request(app)
      .put('/api/v1/partner/application')
      .set(bearer(user.accessToken))
      .send({ tax: { taxDetails: { pan: 'NOT-A-PAN' } } })
      .expect(422);
    expect(bad.body.error.details.fieldErrors['tax.taxDetails.pan']).toBeDefined();

    const restored = await request(app)
      .get('/api/v1/partner/application')
      .set(bearer(user.accessToken))
      .expect(200);
    expect(restored.body.data.business.businessName).toBe('Lakeview');
  });

  it('encrypts the settlement account and never returns the full number', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const res = await request(app)
      .put('/api/v1/partner/application')
      .set(bearer(user.accessToken))
      .send(completeApplication)
      .expect(200);
    expect(res.body.data.settlementAccount).toMatchObject({
      accountNumberLast4: '9012',
      ifsc: 'EXMP0001234',
    });
    expect(JSON.stringify(res.body)).not.toContain('123456789012');
    const stored = await PartnerModel.findOne({ ownerId: user.id })
      .select('+settlementAccount.accountNumberEncrypted')
      .lean();
    expect(stored?.settlementAccount?.accountNumberEncrypted).toMatch(/^v1\./);
    expect(stored?.settlementAccount?.accountNumberEncrypted).not.toContain('123456789012');
  });

  it('validates document content and keeps documents private', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const other = await registerUser(app);
    await request(app)
      .put('/api/v1/partner/application')
      .set(bearer(user.accessToken))
      .send(completeApplication)
      .expect(200);
    const fake = await uploadDoc(
      app,
      user,
      'IDENTITY_PROOF',
      Buffer.from('MZ executable'),
      'id.pdf',
    );
    expect(fake.status).toBe(415);
    const ok = await uploadDoc(app, user, 'IDENTITY_PROOF');
    expect(ok.status).toBe(200);
    const docId = ok.body.data.documents[0].id;
    const download = await request(app)
      .get(`/api/v1/partner/application/documents/${docId}`)
      .set(bearer(user.accessToken))
      .expect(200);
    expect(download.headers['content-disposition']).toMatch(/attachment/);
    expect(download.headers['cache-control']).toMatch(/no-store/);
    await request(app)
      .get(`/api/v1/partner/application/documents/${docId}`)
      .set(bearer(other.accessToken))
      .expect(404);
    expect(ok.body.data.documents[0]).not.toHaveProperty('privateKey');
  });

  it('runs the full review workflow including resubmission and approval', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const user = await registerUser(app);
    const auth = bearer(user.accessToken);
    await request(app)
      .put('/api/v1/partner/application')
      .set(auth)
      .send(completeApplication)
      .expect(200);

    const incomplete = await request(app)
      .post('/api/v1/partner/application/submit')
      .set(auth)
      .expect(422);
    expect(incomplete.body.error.details.formErrors.join(' ')).toMatch(/Business registration/);

    for (const type of ['BUSINESS_REGISTRATION', 'IDENTITY_PROOF', 'BANK_PROOF'])
      expect((await uploadDoc(app, user, type)).status).toBe(200);
    const submitted = await request(app)
      .post('/api/v1/partner/application/submit')
      .set(auth)
      .expect(200);
    const id = submitted.body.data.id;
    expect(submitted.body.data.verificationStatus).toBe('UNDER_REVIEW');
    await request(app)
      .put('/api/v1/partner/application')
      .set(auth)
      .send({ business: { businessName: 'Changed' } })
      .expect(409);

    // Customers cannot review; admins can.
    await request(app)
      .post(`/api/v1/admin/partners/${id}/decision`)
      .set(auth)
      .send({ decision: 'APPROVE' })
      .expect(403);
    const list = await request(app)
      .get('/api/v1/admin/partners?status=UNDER_REVIEW')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(list.body.data.items.map((p: { id: string }) => p.id)).toContain(id);
    await request(app)
      .get(`/api/v1/admin/partners/${id}/documents/${submitted.body.data.documents[0].id}`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const requested = await request(app)
      .post(`/api/v1/admin/partners/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'REQUEST_DOCUMENTS', reason: 'Bank letter is unreadable' })
      .expect(200);
    expect(requested.body.data).toMatchObject({
      verificationStatus: 'DOCUMENTS_PENDING',
      rejectionReason: 'Bank letter is unreadable',
    });
    await uploadDoc(app, user, 'BANK_PROOF', PDF, 'bank-letter.pdf');
    await request(app).post('/api/v1/partner/application/submit').set(auth).expect(200);

    const approved = await request(app)
      .post(`/api/v1/admin/partners/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(approved.body.data.verificationStatus).toBe('APPROVED');
    const owner = await UserModel.findById(user.id).lean();
    expect(owner?.roles).toContain('HOTEL_OWNER');
    // Invalid transitions are refused.
    await request(app)
      .post(`/api/v1/admin/partners/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'REJECT', reason: 'late' })
      .expect(409);
  });

  it('allows resubmission after rejection and shows the reason', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const user = await registerUser(app);
    const auth = bearer(user.accessToken);
    await request(app)
      .put('/api/v1/partner/application')
      .set(auth)
      .send(completeApplication)
      .expect(200);
    for (const type of ['BUSINESS_REGISTRATION', 'IDENTITY_PROOF', 'BANK_PROOF'])
      await uploadDoc(app, user, type);
    const { body } = await request(app)
      .post('/api/v1/partner/application/submit')
      .set(auth)
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/partners/${body.data.id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'REJECT', reason: 'GSTIN does not match PAN' })
      .expect(200);
    const mine = await request(app).get('/api/v1/partner/application').set(auth).expect(200);
    expect(mine.body.data).toMatchObject({
      verificationStatus: 'REJECTED',
      rejectionReason: 'GSTIN does not match PAN',
    });
    await request(app)
      .put('/api/v1/partner/application')
      .set(auth)
      .send({ tax: { taxDetails: { gstin: '08ABCDE1234F1Z5' } } })
      .expect(200);
    expect(
      (await request(app).post('/api/v1/partner/application/submit').set(auth).expect(200)).body
        .data.verificationStatus,
    ).toBe('UNDER_REVIEW');
  });
});
