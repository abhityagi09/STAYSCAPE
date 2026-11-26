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

test('a traveller applies a coupon at checkout and pays the discounted total', async ({
  page,
  request,
}) => {
  // Admin creates a coupon through the real API.
  const login = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const { accessToken } = (await login.json()).data as { accessToken: string };
  const code = `E2E${runId}`;
  const created = await request.post('/api/v1/admin/coupons', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      code,
      name: 'E2E ₹500 off',
      discountType: 'FIXED',
      value: 50_000,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);

  await page.goto('/register');
  await page.getByLabel(/^First name/).fill('Asha');
  await page.getByLabel(/^Last name/).fill('Rao');
  await page.getByLabel(/^Email/).fill(`coupon.${runId}@example.com`);
  await page.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const plus = (n: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/hotels?destination=goa&checkIn=${plus(40)}&checkOut=${plus(42)}`);
  const first = page.getByRole('article').first();
  await expect(first).toContainText('₹');
  await first.getByRole('heading', { level: 3 }).getByRole('link').click();
  await page
    .locator('li')
    .filter({ hasText: /Free cancellation until/ })
    .first()
    .getByRole('button', { name: 'Select' })
    .click();
  await page
    .getByRole('complementary', { name: 'Booking summary' })
    .getByRole('button', { name: 'Continue to booking' })
    .click();
  await expect(page.getByText(/Rooms held for \d+:\d\d/)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Coupon code').fill(code.toLowerCase());
  const applied = page.waitForResponse(
    (r) => r.url().includes('/coupon') && r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Apply' }).click();
  const body = (await (await applied).json()) as {
    data: { price: { coupon: { discountMinor: number }; totals: { totalMinor: number } } };
  };
  expect(body.data.price.coupon.discountMinor).toBe(50_000);
  await expect(page.getByText(`Coupon ${code} saves ₹500.00`)).toBeVisible();
  await page.getByLabel(/^Mobile number/).fill('+919811111111');
  await page.getByRole('checkbox', { name: /booking terms/ }).check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page).toHaveURL(/\/checkout\/payment\?booking=SS-/);
  // The amount to pay is the server's discounted total, not the original quote.
  const expected = (body.data.price.totals.totalMinor / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
  });
  await expect(page.getByRole('button', { name: `Pay ₹${expected}` })).toBeVisible();
});
