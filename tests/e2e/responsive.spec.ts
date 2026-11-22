import { expect, test } from '@playwright/test';

test('mobile navigation opens, navigates and closes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Stays worth the journey.' })).toBeVisible();
  // Desktop navigation is hidden at this width; the menu button is shown instead.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'List your property' }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(drawer).toBeHidden();
});

test('homepage search validates and carries criteria to the search page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Where are you going?')).toBeVisible();
  await page.getByLabel('Destination').fill('Goa');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?destination=Goa/);
  await expect(page.getByText('Destination: Goa')).toBeVisible();
  await expect(page.getByText('No bookable stays yet')).toBeVisible();
});

test('pages have no horizontal overflow at phone width', async ({ page }) => {
  for (const path of ['/', '/login', '/register', '/search', '/terms']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
