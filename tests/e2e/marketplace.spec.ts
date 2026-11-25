import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mailpitAvailable, waitForEmailLink } from './support/mailpit';

/**
 * Phase 2 acceptance journey through the real UI and API:
 * partner registers → onboarding → admin approves partner → partner lists a property with
 * photos, rooms and rates → admin approves listing → partner publishes → customer finds it by
 * destination and dates, gets a real quote and reaches the (Phase 3) booking hand-off.
 */
const PASSWORD = 'E2e-Str0ng-Passw0rd';
/** Property-local (Asia/Kolkata) calendar arithmetic, kept local to avoid loading ESM-only workspace packages. */
const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@stayscape.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2e-Admin-Passw0rd';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const runId = `${Date.now()}`.slice(-7);
const city = `Testpur ${runId}`;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe.configure({ mode: 'serial' });

test('partner onboarding → approval → listing → publication → customer quote', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  test.skip(
    !(await mailpitAvailable()),
    'Mailpit is not running — start it with `npm run services:up`.',
  );
  const partner = await newPage(browser);
  const email = `e2e.partner.${runId}@example.com`;

  // ---- register and verify email
  await partner.goto('/register');
  await partner.getByLabel(/^First name/).fill('Priya');
  await partner.getByLabel(/^Last name/).fill('Host');
  await partner.getByLabel(/^Email/).fill(email);
  await partner.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await partner.getByLabel(/^Confirm password/).fill(PASSWORD);
  await partner.getByRole('checkbox', { name: /I agree/ }).check();
  await partner.getByRole('button', { name: 'Create account' }).click();
  await expect(partner).toHaveURL(/\/account$/);
  const verify = new URL(await waitForEmailLink(email, /verify/i, /\/verify-email\?token=/));
  await partner.goto(`${verify.pathname}${verify.search}`);
  await expect(partner.getByRole('heading', { name: 'Email verified' })).toBeVisible();

  // ---- six-step onboarding
  await partner.goto('/partner/onboarding');
  await partner.getByLabel(/^Owner \/ authorised signatory name/).fill('Priya Host');
  await partner.getByLabel(/^Registered business name/).fill(`Testpur Stays ${runId}`);
  await partner.getByRole('button', { name: 'Save and continue' }).click();
  await partner.getByLabel(/^Address line 1/).fill('1 Market Road');
  await partner.getByLabel(/^City/).fill(city);
  await partner.getByLabel(/^State/).fill('Rajasthan');
  await partner.getByLabel(/^Postal code/).fill('313001');
  await partner.getByLabel(/^Business email/).fill(email);
  await partner.getByLabel(/^Business phone/).fill('+919812345678');
  await partner.getByRole('button', { name: 'Save and continue' }).click();
  await partner.getByLabel(/^Business registration number/).fill('LLP-1234');
  await partner.getByLabel(/^PAN/).fill('ABCDE1234F');
  await partner.getByRole('button', { name: 'Save and continue' }).click();
  for (const doc of [
    'Business registration certificate',
    'Identity proof of authorised signatory',
    'Cancelled cheque or bank letter',
  ]) {
    await partner
      .getByLabel(`Upload ${doc}`)
      .setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(partner.getByText('doc.pdf').first()).toBeVisible();
  }
  await partner.getByRole('button', { name: /Settlement account/ }).click();
  await partner.getByLabel(/^Account holder name/).fill('Testpur Stays');
  await partner.getByLabel(/^Bank name/).fill('Example Bank');
  await partner.getByLabel(/^IFSC/).fill('EXMP0001234');
  await partner.getByLabel(/^Account number/).fill('123456789012');
  await partner.getByRole('button', { name: 'Save and continue' }).click();
  await partner.getByRole('button', { name: 'Submit for review' }).click();
  await expect(partner.getByText('Under review', { exact: true })).toBeVisible();

  // ---- admin approves the partner
  const admin = await newPage(browser);
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto('/admin/partners');
  await admin.getByRole('link', { name: `Testpur Stays ${runId}` }).click();
  await admin.getByRole('button', { name: 'Approve' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('Approved', { exact: true })).toBeVisible();

  // ---- partner creates the listing (reload picks up the new HOTEL_OWNER role)
  await partner.goto('/partner/properties/new');
  await partner.getByLabel(/^Property name/).fill(`Testpur Lake Lodge ${runId}`);
  await partner.getByLabel(/^Short description/).fill('Lakeside lodge for e2e testing');
  await partner
    .getByLabel(/^Full description/)
    .fill(
      'A calm lakeside lodge with garden rooms, created by the automated end-to-end test suite.',
    );
  await partner.getByLabel(/^Address line 1/).fill('2 Lake Road');
  await partner.getByLabel(/^City/).fill(city);
  await partner.getByLabel(/^State/).fill('Rajasthan');
  await partner.getByLabel(/^Postal code/).fill('313001');
  await partner.getByLabel(/^Latitude/).fill('24.58');
  await partner.getByLabel(/^Longitude/).fill('73.68');
  await partner.getByLabel(/^Reservations phone/).fill('+919812345678');
  await partner.getByLabel(/^Reservations email/).fill(email);
  await partner.getByRole('button', { name: 'Create property' }).click();
  await expect(partner).toHaveURL(/\/media$/);
  const photo = readFileSync(fileURLToPath(new URL('./fixtures/lodge.png', import.meta.url)));
  await partner
    .locator('input[type=file]')
    .setInputFiles({ name: 'lodge.png', mimeType: 'image/png', buffer: photo });
  await expect(
    partner.getByRole('list', { name: /Listing photos/ }).getByRole('listitem'),
  ).toHaveCount(1, { timeout: 30_000 });
  await partner.getByRole('button', { name: 'Save photos & videos' }).click();
  await expect(partner.getByText('Photos saved')).toBeVisible();

  await partner.getByRole('link', { name: 'Rooms', exact: true }).click();
  await partner.getByRole('link', { name: 'Add room category' }).click();
  await partner.getByLabel(/^Name/).fill('Garden Room');
  await partner.getByLabel(/^Description/).fill('Ground-floor room opening onto the garden.');
  await partner.getByRole('button', { name: 'Add room category' }).click();
  await expect(partner.getByText('Garden Room')).toBeVisible();

  await partner.getByRole('link', { name: 'Rates & pricing' }).click();
  await partner.getByRole('button', { name: 'Add rate plan' }).click();
  await partner.getByLabel(/^Base price/).fill('3200');
  await partner.getByRole('button', { name: 'Save rate plan' }).click();
  await expect(partner.getByRole('cell', { name: '₹3,200.00' })).toBeVisible();

  await partner
    .getByRole('navigation', { name: 'Property sections' })
    .getByRole('link', { name: 'Overview' })
    .click();
  await partner.getByRole('button', { name: 'Submit for review' }).click();
  await expect(partner.getByText('Submitted for review')).toBeVisible();

  // ---- admin approves the listing
  await admin.goto('/admin/properties');
  await admin.getByRole('link', { name: `Testpur Lake Lodge ${runId}` }).click();
  await admin.getByRole('button', { name: 'Approve listing' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('Decision recorded')).toBeVisible();

  // ---- partner publishes
  await partner.reload();
  await partner.getByRole('button', { name: 'Publish to search' }).click();
  await expect(partner.getByText('Listing published')).toBeVisible();

  // ---- a customer finds it by destination and dates and gets a real quote
  const customer = await newPage(browser);
  const checkIn = addDays(todayIst(), 20);
  const checkOut = addDays(checkIn, 2);
  await customer.goto(
    `/hotels?destination=${encodeURIComponent(city)}&checkIn=${checkIn}&checkOut=${checkOut}`,
  );
  await expect(customer.getByText(/1 property available for 2 nights/)).toBeVisible();
  // ₹3,200 × 2 nights + 5% GST = ₹6,720 → ₹3,360 average per night
  await expect(customer.getByRole('article')).toContainText('₹3,360');
  await customer.getByRole('link', { name: `Testpur Lake Lodge ${runId}` }).click();
  await customer.getByRole('button', { name: 'Select' }).first().click();
  const summary = customer.getByRole('complementary', { name: 'Booking summary' });
  await expect(summary).toContainText('₹6,720.00');
  await summary.getByRole('button', { name: 'Continue to booking' }).click();
  await expect(customer.getByText('Price and availability confirmed just now.')).toBeVisible();
  await expect(customer.getByRole('button', { name: 'Booking available soon' })).toBeDisabled();
});

test('map discovery and comparison on seeded listings', async ({ page }) => {
  await page.goto('/hotels?destination=goa');
  await expect(page.getByRole('heading', { name: 'Stays in goa' })).toBeVisible();
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();

  await cards.nth(0).getByRole('button', { name: 'Compare' }).click();
  await cards.nth(1).getByRole('button', { name: 'Compare' }).click();
  const tray = page.getByRole('region', { name: 'Comparison tray' });
  await expect(tray.getByRole('listitem')).toHaveCount(2);
  await tray.getByRole('link', { name: /Compare 2/ }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Guest rating' })).toBeVisible();

  await page.goto('/hotels?destination=goa&view=map');
  const map = page.locator('.maplibregl-canvas');
  await expect(map.or(page.getByText('The map could not be loaded'))).toBeVisible({
    timeout: 20_000,
  });
  const firstCard = page.getByRole('article').first();
  await expect(firstCard).toBeVisible(); // accessible list stays available
  const mapLoaded = await map.isVisible();
  // Tiles come from an external provider; record whether the map assertions ran.
  test.info().annotations.push({
    type: 'map',
    description: mapLoaded ? 'loaded — popup checked' : 'tiles unavailable — popup not checked',
  });
  if (mapLoaded) {
    // The map container must really have height (it once collapsed to 0 and clipped everything).
    const region = await page.getByRole('region', { name: /Map of search results/ }).boundingBox();
    expect(region?.height ?? 0).toBeGreaterThan(250);
    // List → map synchronisation: hovering a result opens that property's popup on the map.
    const name = (await firstCard.getByRole('heading', { level: 3 }).textContent())!.trim();
    await firstCard.hover();
    const popup = page.locator('.maplibregl-popup');
    await expect(popup).toContainText(name);
    await expect(popup.getByRole('link', { name: 'View property' })).toHaveAttribute(
      'href',
      /^\/hotels\/[a-z0-9-]+/,
    );
  }

  // A destination gives a reference point, so results can be sorted by distance from it.
  await page.goto('/hotels?destination=goa');
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('distance');
  await expect(page).toHaveURL(/sort=distance/);
  await expect(page.getByRole('article').first()).toContainText(/km/);
});
