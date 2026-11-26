import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Phase 4 journeys through the real UI, API and database: an editor drafts and publishes a guide
 * that only then becomes public; the platform dashboard and support queue load for an admin; a
 * traveller plans a trip, asks the (deterministic, no-AI) assistant about seeded Goa stays,
 * views rewards, and switches the interface to Hindi. Requires seed data (`npm run seed`).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@stayscape.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2e-Admin-Passw0rd';
const PASSWORD = 'E2e-Str0ng-Passw0rd';
const runId = `${Date.now()}`.slice(-7);

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test('an editor publishes a guide; it is public only after publishing', async ({ browser }) => {
  const slug = `e2e-guide-${runId}`;
  const admin = await newPage(browser);
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto('/admin/content');
  await admin.getByRole('button', { name: 'New content' }).click();
  await admin.getByLabel('Slug').fill(slug);
  await admin.getByLabel('Title', { exact: true }).fill(`Monsoon weekend ${runId}`);
  await admin.getByLabel(/^Body/).fill('## Why go\n\nGreen hills and **quiet** beaches.');
  await admin.getByRole('button', { name: 'Save draft' }).click();
  await expect(admin.getByText('Draft saved')).toBeVisible();

  const visitor = await newPage(browser);
  await visitor.goto(`/guides/${slug}`);
  await expect(visitor.getByText(`Monsoon weekend ${runId}`)).toHaveCount(0);

  await admin.getByRole('button', { name: new RegExp(`Monsoon weekend ${runId}`) }).click();
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('Published', { exact: true })).toBeVisible();

  await visitor.goto(`/guides/${slug}`);
  await expect(
    visitor.getByRole('heading', { level: 1, name: `Monsoon weekend ${runId}` }),
  ).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 2, name: 'Why go' })).toBeVisible();
  await expect(visitor.locator('strong', { hasText: 'quiet' })).toBeVisible();
});

test('admin dashboard and support queue load real data', async ({ browser }) => {
  const admin = await newPage(browser);
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto('/admin/dashboard');
  await expect(admin.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible();
  await expect(admin.getByText('Published properties')).toBeVisible();
  await admin.goto('/admin/support');
  await expect(admin.getByRole('table', { name: 'Support tickets' })).toBeVisible();
  await admin.goto('/admin/settlements');
  await expect(admin.getByText('Automated payouts are disabled')).toBeVisible();
});

test('a traveller plans a trip, asks the assistant, sees rewards and switches to Hindi', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel(/^First name/).fill('Kabir');
  await page.getByLabel(/^Last name/).fill('Shah');
  await page.getByLabel(/^Email/).fill(`planner.${runId}@example.com`);
  await page.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.goto('/trips/new');
  await page.getByLabel(/^Trip name/).fill('Goa with friends');
  await page.getByLabel('Destination').fill('Goa');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page.getByRole('heading', { name: 'Goa with friends' })).toBeVisible();
  await page.getByLabel('Note title').fill('Sunset at Chapora');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Sunset at Chapora')).toBeVisible();

  await page.goto('/account/assistant');
  await page.getByLabel(/Ask about places to stay/).fill('Stays in Goa');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/I found \d+ stays? in Goa/)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('region', { name: 'Conversation' }).getByRole('link').first(),
  ).toHaveAttribute('href', /^\/hotels\//);

  await page.goto('/account/rewards');
  await expect(page.getByText('Points balance')).toBeVisible();

  await page.getByLabel('Language').first().selectOption('hi');
  await expect(page.getByRole('link', { name: 'बुकिंग' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
});
