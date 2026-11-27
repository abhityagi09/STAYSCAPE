import { expect, test, type Page } from '@playwright/test';
import { mailpitAvailable, waitForEmailLink } from './support/mailpit';

const PASSWORD = 'E2e-Str0ng-Passw0rd';
const NEW_PASSWORD = 'E2e-Rotated-Passw0rd';

function uniqueEmail(tag: string) {
  return `e2e.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Rewrite an emailed link onto the base URL under test (email links use WEB_APP_URL). */
function localise(link: string, page: Page) {
  const url = new URL(link);
  return new URL(`${url.pathname}${url.search}`, page.url()).toString();
}

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel(/^First name/).fill('Esha');
  await page.getByLabel(/^Last name/).fill('Tester');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  test.skip(
    !(await mailpitAvailable()),
    'Mailpit is not running — start it with `npm run services:up`.',
  );
});

test('register, verify email, update profile, sign out and back in', async ({ page }) => {
  // Long multi-page journey; against a cold Vite dev server every module compiles on first load.
  test.slow();
  const email = uniqueEmail('journey');
  await register(page, email);
  await expect(page.getByRole('heading', { name: 'Hello, Esha' })).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Verify your email address' }),
  ).toBeVisible();

  // Verification email delivered through SMTP to Mailpit.
  const verifyLink = await waitForEmailLink(email, /verify/i, /\/verify-email\?token=/);
  await page.goto(localise(verifyLink, page));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to my account' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Esha/ })).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Verify your email address' }),
  ).toHaveCount(0);

  // Session survives a full reload via the HttpOnly refresh cookie (access token is memory-only).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Esha' })).toBeVisible();

  // Profile update persists.
  await page.goto('/account/profile');
  await page.getByLabel(/^First name/).fill('Eshani');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^First name/)).toHaveValue('Eshani');

  await signOut(page);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount/);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Hello, Eshani' })).toBeVisible();
});

test('rejects invalid credentials with a generic message', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, uniqueEmail('nobody'), 'Wrong-Passw0rd1');
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
});

test('password reset through the test mail service', async ({ page }) => {
  const email = uniqueEmail('reset');
  await register(page, email);
  await signOut(page);

  await page.goto('/forgot-password');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const resetLink = await waitForEmailLink(email, /reset your/i, /\/reset-password\?token=/);
  await page.goto(localise(resetLink, page));
  await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
  await page.getByLabel(/^Confirm new password/).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/\/login\?reason=reset/);

  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel(/^Password/).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // The one-time link cannot be reused.
  await page.goto(localise(resetLink, page));
  await page.getByLabel(/^New password/).fill('E2e-Third-Passw0rd');
  await page.getByLabel(/^Confirm new password/).fill('E2e-Third-Passw0rd');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid or has expired/);
});

test('protected and role-restricted routes', async ({ page }) => {
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount%2Fsecurity/);

  const email = uniqueEmail('rbac');
  await page.goto('/register?redirect=/account/security');
  await page.getByLabel(/^First name/).fill('Ravi');
  await page.getByLabel(/^Last name/).fill('Tester');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByText('This device')).toBeVisible();

  // A customer cannot reach the admin workspace, and the API refuses regardless of the UI.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /don't have access/i })).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/v1/users')).status);
  expect(status).toBe(401);
});

test('downloads a copy of my data and deletes the account', async ({ page }) => {
  test.slow();
  const email = uniqueEmail('privacy');
  await register(page, email);
  await page.goto('/account/settings');
  const card = page.getByRole('heading', { name: 'Your data' });
  await expect(card).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^stayscape-data-\d{4}-\d{2}-\d{2}\.json$/);
  const body = JSON.parse(
    await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')),
  );
  expect(body.account.email).toBe(email);
  expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/);

  await page.getByRole('button', { name: 'Delete account…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  const confirm = dialog.getByRole('button', { name: 'Delete account' });
  await dialog.getByLabel('Current password').fill(PASSWORD);
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page).toHaveURL(/\/login\?reason=account-deleted$/);
  await expect(page.getByText(/Your account has been deleted\./)).toBeVisible();

  // The old credentials no longer work.
  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('alert').filter({ hasText: /incorrect|invalid/i })).toBeVisible();
});
