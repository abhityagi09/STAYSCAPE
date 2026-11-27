/**
 * Browser-level resilience: deep links, refresh, back/forward, network interruption and an
 * ended session (Phase 5, task 8).
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'E2e-Str0ng-Passw0rd';

async function firstSlug(page: Page) {
  const body = (await (
    await page.request.get('/api/v1/hotels?destination=goa&limit=1')
  ).json()) as {
    data: { items: Array<{ slug: string; name: string }> };
  };
  return body.data.items[0]!;
}

test('deep links and refresh render the property page directly', async ({ page }) => {
  const hotel = await firstSlug(page);
  await page.goto(`/hotels/${hotel.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: hotel.name })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(hotel.name));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: hotel.name })).toBeVisible();
  // An unknown deep link shows the not-found page, not a blank screen.
  await page.goto('/hotels/no-such-stay-anywhere');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('back and forward restore the search with its filters', async ({ page }) => {
  await page.goto('/hotels?destination=goa&sort=price_asc');
  await expect(page.getByRole('heading', { name: 'Stays in goa' })).toBeVisible();
  const first = page.getByRole('article').first();
  const name = (await first.getByRole('heading').first().textContent())!.trim();
  await first.getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/destination=goa/);
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(page.getByRole('heading', { name: 'Stays in goa' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});

test('a network interruption shows a recoverable error instead of failing silently', async ({
  page,
}) => {
  // The search request fails as if the connection dropped.
  await page.route('**/api/v1/hotels?**', (route) => route.abort('internetdisconnected'));
  await page.goto('/hotels?destination=goa');
  const retry = page.getByRole('button', { name: /try again|retry/i });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  // Connection restored: retrying recovers without a reload.
  await page.unroute('**/api/v1/hotels?**');
  await retry.click();
  await expect(page.getByRole('article').first()).toBeVisible();
});

test('an ended session sends the user to sign in and back to the deep link', async ({
  page,
  context,
}) => {
  const email = `e2e.session.${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel(/^First name/).fill('Esha');
  await page.getByLabel(/^Last name/).fill('Tester');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password\*?$/).fill(PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // The refresh session disappears (expired or revoked elsewhere); the in-memory token is lost on reload.
  await context.clearCookies();
  await page.goto('/account/bookings');
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount%2Fbookings/);
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account\/bookings$/);
});
