import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUTH_COOKIES } from '@stayscape/shared';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { UserModel } from '@/modules/users/user.model';
import {
  TEST_PASSWORD,
  bearer,
  cookiesFrom,
  createTestContext,
  csrfHeaders,
  extractToken,
  loginUser,
  rawSetCookies,
  registerPayload,
  registerUser,
  testConfig,
} from '@/test/helpers';
import { VerificationTokenModel } from './verification-token.model';

describe('POST /auth/register', () => {
  it('creates a customer, signs them in and never exposes the password hash', async () => {
    const { app, mailer } = createTestContext();
    const payload = registerPayload({ email: '  New.User@Example.COM ', phone: '+919876543210' });
    const res = await request(app).post('/api/v1/auth/register').send(payload).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      email: 'new.user@example.com',
      roles: ['CUSTOMER'],
      emailVerified: false,
      phone: '+919876543210',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const setCookies = rawSetCookies(res).join('\n');
    expect(setCookies).toMatch(new RegExp(`${AUTH_COOKIES.refreshToken}=[^;]+;.*HttpOnly`));
    expect(setCookies).toMatch(/Path=\/api\/v1\/auth/);
    expect(setCookies).toMatch(/SameSite=Strict/);

    const stored = await UserModel.findOne({ email: 'new.user@example.com' })
      .select('+passwordHash')
      .lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);

    // Refresh tokens are stored hashed only.
    const session = await RefreshSessionModel.findOne({ userId: stored?._id }).lean();
    expect(session?.tokenHash).toHaveLength(64);
    expect(session?.tokenHash).not.toBe(cookiesFrom(res)[AUTH_COOKIES.refreshToken]);

    // Verification email queued and delivered via the provider abstraction.
    const mail = mailer.lastTo('new.user@example.com');
    expect(mail?.subject).toMatch(/verify/i);
    expect(mail?.text).toMatch(/\/verify-email\?token=/);
  });

  it('rejects duplicate email addresses regardless of case', async () => {
    const { app } = createTestContext();
    await request(app)
      .post('/api/v1/auth/register')
      .send(registerPayload({ email: 'dup@example.com' }))
      .expect(201);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(registerPayload({ email: 'DUP@example.com' }))
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await UserModel.countDocuments({ email: 'dup@example.com' })).toBe(1);
  });

  it('validates input and reports field errors', async () => {
    const { app } = createTestContext();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        firstName: '',
        lastName: 'Rao',
        email: 'not-an-email',
        password: 'weak',
        acceptTerms: false,
      })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = Object.keys(res.body.error.details.fieldErrors);
    expect(fields).toEqual(
      expect.arrayContaining(['firstName', 'email', 'password', 'acceptTerms']),
    );
  });

  it('does not allow privileged roles to be assigned during registration', async () => {
    const { app } = createTestContext();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(registerPayload({ roles: ['SUPER_ADMIN'], accountStatus: 'ACTIVE' }))
      .expect(422);
    expect(res.body.error.details.fieldErrors.roles).toBeDefined();
    expect(await UserModel.countDocuments()).toBe(0);
  });
});

describe('POST /auth/login', () => {
  it('signs in with valid credentials and records the login', async () => {
    const { app } = createTestContext();
    const created = await registerUser(app);
    await UserModel.updateOne({ _id: created.id }, { $set: { lastLoginAt: null } });

    const signedIn = await loginUser(app, created.email);
    expect(signedIn.accessToken).toBeTruthy();
    expect(signedIn.refreshToken).toBeTruthy();

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(signedIn.accessToken))
      .expect(200);
    expect(me.body.data.email).toBe(created.email);
    const user = await UserModel.findById(created.id).lean();
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
    expect(await AuditLogModel.countDocuments({ action: 'auth.login', actorId: user?._id })).toBe(
      1,
    );
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const { app } = createTestContext();
    const created = await registerUser(app);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: created.email, password: 'Wrong-Passw0rd' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong-Passw0rd' })
      .expect(401);

    expect(wrongPassword.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    expect(rawSetCookies(wrongPassword).join('')).not.toContain(AUTH_COOKIES.refreshToken);
  });

  it('rejects malformed login input', async () => {
    const { app } = createTestContext();
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'x' }).expect(422);
    expect(res.body.error.details.fieldErrors).toHaveProperty('password');
  });

  it('enforces account status only after the password is verified', async () => {
    const { app } = createTestContext();
    const created = await registerUser(app);
    await UserModel.updateOne({ _id: created.id }, { $set: { accountStatus: 'SUSPENDED' } });

    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: created.email, password: 'Nope-Passw0rd' });
    expect(bad.status).toBe(401);
    const good = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: created.email, password: TEST_PASSWORD });
    expect(good.status).toBe(403);
    expect(good.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rate limits repeated login attempts', async () => {
    const { app } = createTestContext({ env: { LOGIN_RATE_LIMIT_MAX: '3' } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'victim@example.com', password: 'Guess-Passw0rd' })
        .expect(401);
    }
    const limited = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'victim@example.com', password: 'Guess-Passw0rd' })
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('token refresh', () => {
  it('rotates the refresh token and issues a working access token', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        `${AUTH_COOKIES.refreshToken}=${user.refreshToken}`,
        `${AUTH_COOKIES.csrfToken}=${user.csrfToken}`,
      ])
      .set(csrfHeaders(user))
      .expect(200);

    const rotated = cookiesFrom(res)[AUTH_COOKIES.refreshToken];
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(user.refreshToken);
    await request(app).get('/api/v1/auth/me').set(bearer(res.body.data.accessToken)).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('requires a matching CSRF token', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const cookie = [
      `${AUTH_COOKIES.refreshToken}=${user.refreshToken}`,
      `${AUTH_COOKIES.csrfToken}=${user.csrfToken}`,
    ];

    const missing = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('x-csrf-token', 'forged-value')
      .expect(403);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set({ 'x-csrf-token': user.csrfToken, Origin: 'https://evil.example' })
      .expect(403);
  });

  it('rejects a missing or unknown refresh token', async () => {
    const { app } = createTestContext();
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`${AUTH_COOKIES.csrfToken}=abc`])
      .set('x-csrf-token', 'abc')
      .expect(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('detects refresh token reuse and revokes the whole session family', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const cookieFor = (token: string) => [
      `${AUTH_COOKIES.refreshToken}=${token}`,
      `${AUTH_COOKIES.csrfToken}=${user.csrfToken}`,
    ];

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieFor(user.refreshToken))
      .set(csrfHeaders(user))
      .expect(200);
    const legitimateNext = cookiesFrom(first)[AUTH_COOKIES.refreshToken] ?? '';

    // An attacker replays the original (already rotated) token.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieFor(user.refreshToken))
      .set(csrfHeaders(user))
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate successor is now revoked too, as is the access token's session.
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieFor(legitimateNext))
      .set(csrfHeaders(user))
      .expect(401);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(first.body.data.accessToken))
      .expect(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    expect(await AuditLogModel.countDocuments({ action: 'auth.refresh_reuse_detected' })).toBe(1);
  });
});

describe('logout', () => {
  it('revokes the current session and clears cookies', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);

    const res = await user.agent.post('/api/v1/auth/logout').set(csrfHeaders(user)).expect(200);
    expect(rawSetCookies(res).join('\n')).toMatch(new RegExp(`${AUTH_COOKIES.refreshToken}=;`));

    await request(app).get('/api/v1/auth/me').set(bearer(user.accessToken)).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        `${AUTH_COOKIES.refreshToken}=${user.refreshToken}`,
        `${AUTH_COOKIES.csrfToken}=${user.csrfToken}`,
      ])
      .set(csrfHeaders(user))
      .expect(401);
  });

  it('logout-all revokes every session for the user', async () => {
    const { app } = createTestContext();
    const first = await registerUser(app);
    const second = await loginUser(app, first.email);

    await first.agent
      .post('/api/v1/auth/logout-all')
      .set(bearer(first.accessToken))
      .set(csrfHeaders(first))
      .expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer(second.accessToken)).expect(401);
    expect(await RefreshSessionModel.countDocuments({ userId: first.id, revokedAt: null })).toBe(0);
  });
});

describe('password reset', () => {
  it('responds generically and sends nothing for unknown accounts', async () => {
    const { app, mailer } = createTestContext();
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' })
      .expect(202);
    expect(res.body.data.message).toMatch(/if an account exists/i);
    expect(mailer.sent).toHaveLength(0);
  });

  it('resets the password with a single-use token and revokes sessions', async () => {
    const { app, mailer } = createTestContext();
    const user = await registerUser(app);
    mailer.clear();

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    const token = extractToken(mailer.lastTo(user.email)?.text ?? '');
    const stored = await VerificationTokenModel.findOne({ purpose: 'PASSWORD_RESET' }).lean();
    expect(stored?.tokenHash).not.toBe(token);

    const newPassword = 'Brand-New-Passw0rd';
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);

    // Existing sessions are gone; old password fails; new password works.
    await request(app).get('/api/v1/auth/me').set(bearer(user.accessToken)).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);

    // Token cannot be reused.
    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another-Passw0rd' })
      .expect(400);
    expect(reuse.body.error.code).toBe('VERIFICATION_TOKEN_INVALID');
    expect(mailer.sent.some((mail) => /password was changed/i.test(mail.subject))).toBe(true);
  });

  it('rejects expired reset tokens', async () => {
    const { app, mailer } = createTestContext();
    const user = await registerUser(app);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    const token = extractToken(mailer.lastTo(user.email)?.text ?? '');
    await VerificationTokenModel.updateMany(
      { purpose: 'PASSWORD_RESET' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Brand-New-Passw0rd' })
      .expect(400);
  });

  it('invalidates older reset links when a new one is requested', async () => {
    const { app, mailer } = createTestContext();
    const user = await registerUser(app);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    const firstToken = extractToken(mailer.lastTo(user.email)?.text ?? '');
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: firstToken, password: 'Brand-New-Passw0rd' })
      .expect(400);
  });
});

describe('email verification', () => {
  it('verifies the email once with the emailed token', async () => {
    const { app, mailer } = createTestContext();
    const user = await registerUser(app);
    const token = extractToken(mailer.lastTo(user.email)?.text ?? '');

    const res = await request(app).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    expect(res.body.data.user.emailVerified).toBe(true);
    const reuse = await request(app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect(reuse.body.error.code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  it('rejects malformed tokens', async () => {
    const { app } = createTestContext();
    await request(app).post('/api/v1/auth/verify-email').send({ token: 'short' }).expect(422);
    await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'x'.repeat(43) })
      .expect(400);
  });

  it('resend-verification is generic and respects a cooldown', async () => {
    const { app, mailer } = createTestContext();
    const user = await registerUser(app);
    const before = mailer.sent.length;
    await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email })
      .expect(202);
    expect(mailer.sent.length).toBe(before); // within cooldown of the registration email
    // Mongoose treats createdAt as immutable, so backdate through the driver.
    await VerificationTokenModel.collection.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 120_000) } },
    );
    await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email })
      .expect(202);
    expect(mailer.sent.length).toBe(before + 1);
    await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ghost@example.com' })
      .expect(202);
  });
});

describe('change password', () => {
  it('requires the current password and keeps only the current session', async () => {
    const { app } = createTestContext();
    const first = await registerUser(app);
    const second = await loginUser(app, first.email);

    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(first.accessToken))
      .send({ currentPassword: 'Wrong-Passw0rd', newPassword: 'Changed-Passw0rd1' })
      .expect(422);
    expect(wrong.body.error.details.fieldErrors.currentPassword).toBeDefined();

    await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(first.accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Changed-Passw0rd1' })
      .expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer(first.accessToken)).expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer(second.accessToken)).expect(401);
  });
});

describe('unauthorised access', () => {
  it('rejects requests without, with malformed, forged or expired tokens', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const config = testConfig();

    const none = await request(app).get('/api/v1/auth/me').expect(401);
    expect(none.body.error.code).toBe('AUTH_REQUIRED');
    await request(app).get('/api/v1/auth/me').set('Authorization', 'Basic abc').expect(401);

    const forged = jwt.sign({ sid: 'x', typ: 'access' }, 'a-completely-different-secret-value-xx', {
      subject: user.id,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    });
    expect(
      (await request(app).get('/api/v1/auth/me').set(bearer(forged)).expect(401)).body.error.code,
    ).toBe('TOKEN_INVALID');

    const expired = jwt.sign({ sid: 'x', typ: 'access' }, config.JWT_ACCESS_SECRET, {
      subject: user.id,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      expiresIn: -10,
    });
    expect(
      (await request(app).get('/api/v1/auth/me').set(bearer(expired)).expect(401)).body.error.code,
    ).toBe('TOKEN_EXPIRED');

    const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: user.id, sid: 'x', typ: 'access' }),
    ).toString('base64url')}.`;
    await request(app).get('/api/v1/auth/me').set(bearer(noneAlg)).expect(401);
  });
});
