/**
 * Phase 5 quality gates: responsive layout at representative widths, automated WCAG 2.2 AA
 * checks (axe-core), keyboard access, reduced motion, text resizing, touch targets and
 * Core Web Vitals. Findings are written to the test output folder (quality-report.json).
 */
import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Seed-Dev-Passw0rd';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@stayscape.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2e-Admin-Passw0rd';

async function firstHotelSlug(page: Page): Promise<string> {
  const res = await page.request.get('/api/v1/hotels?limit=1');
  const body = (await res.json()) as { data: { items: Array<{ slug: string }> } };
  return body.data.items[0]!.slug;
}

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(300);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Third-party map canvas and its attribution control are outside our markup.
    .exclude('.maplibregl-map')
    .analyze();
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

test.describe('quality gates', () => {
  test.describe.configure({ mode: 'serial' });
  const report: Record<string, unknown> = {};
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument
  test.afterAll(async ({}, testInfo) => {
    writeFileSync(testInfo.outputPath('quality-report.json'), JSON.stringify(report, null, 2));
    // Also keep a copy at a stable path for the release report.
    writeFileSync('test-results/quality-report.json', JSON.stringify(report, null, 2));
  });

  test('no horizontal overflow at nine widths; screenshots of key screens', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const slug = await firstHotelSlug(page);
    const pages = [
      '/',
      '/hotels?destination=goa',
      `/hotels/${slug}`,
      '/login',
      '/register',
      '/partners',
      '/terms',
      '/help/faq',
      '/guides',
    ];
    const overflow: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of pages) {
        await page.goto(path);
        await settle(page);
        const extra = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (extra > 1) overflow.push(`${width}px ${path} (+${extra}px)`);
        if (
          [375, 768, 1440].includes(width) &&
          ['/', '/hotels?destination=goa', `/hotels/${slug}`].includes(path)
        )
          await page.screenshot({
            path: testInfo.outputPath(
              `screens/${width}-${path === '/' ? 'home' : path.includes('?') ? 'search' : 'hotel'}.png`,
            ),
            fullPage: false,
          });
      }
    }
    report.overflow = overflow;
    expect(overflow).toEqual([]);
  });

  test('no serious or critical WCAG 2.2 AA violations on public pages (desktop and phone)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = await firstHotelSlug(page);
    const results: Record<string, unknown> = {};
    const blocking: string[] = [];
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        '/',
        '/hotels?destination=goa',
        `/hotels/${slug}`,
        '/login',
        '/register',
        '/partners',
        '/help/faq',
      ]) {
        await page.goto(path);
        await settle(page);
        const v = await axe(page);
        results[`${width} ${path}`] = v;
        for (const x of v)
          if (x.impact === 'serious' || x.impact === 'critical')
            blocking.push(`${width} ${path}: ${x.id} (${x.nodes}) ${x.targets.join(' | ')}`);
      }
    }
    report.axePublic = results;
    expect(blocking).toEqual([]);
  });

  test('signed-in customer, partner and admin workspaces pass automated checks', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const results: Record<string, unknown> = {};
    const blocking: string[] = [];
    const areas: Array<[string, string, string, string[]]> = [
      [
        'customer',
        'seed.traveller@stayscape.dev',
        SEED_PASSWORD,
        ['/account', '/account/bookings', '/account/settings', '/account/saved'],
      ],
      [
        'partner',
        'seed.partner1@stayscape.dev',
        SEED_PASSWORD,
        ['/partner', '/partner/properties', '/partner/reservations', '/partner/inventory'],
      ],
      [
        'admin',
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        ['/admin', '/admin/bookings', '/admin/promotions', '/admin/operations'],
      ],
    ];
    for (const [area, email, password, paths] of areas) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const ok = await signIn(page, email, password);
      results[`${area}:signedIn`] = ok;
      if (!ok) {
        blocking.push(`${area}: could not sign in (set E2E_SEED_PASSWORD / E2E_ADMIN_PASSWORD)`);
        await context.close();
        continue;
      }
      for (const path of paths) {
        await page.goto(path);
        await settle(page);
        const v = await axe(page);
        results[path] = v;
        for (const x of v)
          if (x.impact === 'serious' || x.impact === 'critical')
            blocking.push(`${path}: ${x.id} (${x.nodes}) ${x.targets.join(' | ')}`);
        // Phone width: dashboards must not scroll sideways (tables scroll inside their card).
        await page.setViewportSize({ width: 375, height: 800 });
        const extra = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (extra > 1) blocking.push(`${path}: horizontal overflow at 375px (+${extra}px)`);
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      await context.close();
    }
    report.axeWorkspaces = results;
    expect(blocking).toEqual([]);
  });

  test('keyboard: skip link first, visible focus, dialogs trap and return focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await settle(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    // Every focusable control in the header shows a visible focus indicator.
    const missing: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visible =
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return {
          label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? el.tagName,
          visible,
        };
      });
      if (info && !info.visible) missing.push(info.label);
    }
    report.focusWithoutIndicator = missing;
    expect(missing).toEqual([]);
    // Mobile menu dialog: focus moves in, Escape closes it and focus returns to the trigger.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open menu' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('reduced motion and 200% text size are respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/hotels?destination=goa');
    await settle(page);
    const longest = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('*')].map((el) => {
          const s = getComputedStyle(el);
          return Math.max(
            parseFloat(s.animationDuration) || 0,
            parseFloat(s.transitionDuration) || 0,
          );
        }),
      ),
    );
    expect(longest).toBeLessThanOrEqual(0.01);
    // Browser text size at 200% (WCAG 1.4.4): the browser's default font size doubles, exactly as
    // a user's text-size preference does, so rem-based layouts and breakpoints respond to it.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    const overflow: string[] = [];
    for (const path of ['/', '/hotels?destination=goa', '/login']) {
      await page.goto(path);
      await settle(page);
      const extra = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (extra > 1) overflow.push(`${path} +${extra}px`);
    }
    report.textZoomOverflow = overflow;
    expect(overflow).toEqual([]);
  });

  test('touch targets are at least 24×24 CSS pixels at phone width (WCAG 2.5.8)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const slug = await firstHotelSlug(page);
    const small: string[] = [];
    for (const path of ['/', '/hotels?destination=goa', `/hotels/${slug}`, '/login']) {
      await page.goto(path);
      await settle(page);
      const found = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'button, [role="button"], input[type="checkbox"], input[type="radio"], select',
          ),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return (
              r.width > 0 &&
              r.height > 0 &&
              s.visibility !== 'hidden' &&
              !el.closest('.maplibregl-map')
            );
          })
          .map((el) => ({
            r: el.getBoundingClientRect(),
            label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30),
          }))
          .filter(({ r }) => r.width < 24 || r.height < 24)
          .map(
            ({ r, label }) =>
              `${label || '(unlabelled)'} ${Math.round(r.width)}×${Math.round(r.height)}`,
          ),
      );
      for (const f of found) small.push(`${path}: ${f}`);
    }
    report.smallTargets = small;
    expect(small).toEqual([]);
  });

  test('Core Web Vitals on the home, search and property pages (lab, desktop)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const slug = await firstHotelSlug(page);
    const vitals: Record<string, unknown> = {};
    for (const path of ['/', '/hotels?destination=goa', `/hotels/${slug}`]) {
      await page.goto(path, { waitUntil: 'load' });
      await settle(page);
      const m = await page.evaluate(
        () =>
          new Promise<{ lcp: number; cls: number; ttfb: number; fcp: number; transferKb: number }>(
            (resolve) => {
              let lcp = 0;
              let cls = 0;
              new PerformanceObserver((list) => {
                for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
              }).observe({ type: 'largest-contentful-paint', buffered: true });
              new PerformanceObserver((list) => {
                for (const e of list.getEntries() as Array<
                  PerformanceEntry & { value: number; hadRecentInput: boolean }
                >)
                  if (!e.hadRecentInput) cls += e.value;
              }).observe({ type: 'layout-shift', buffered: true });
              setTimeout(() => {
                const nav = performance.getEntriesByType(
                  'navigation',
                )[0] as PerformanceNavigationTiming;
                const fcp =
                  performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
                const transfer = performance
                  .getEntriesByType('resource')
                  .reduce(
                    (s, r) => s + ((r as PerformanceResourceTiming).transferSize || 0),
                    nav.transferSize || 0,
                  );
                resolve({
                  lcp,
                  cls,
                  ttfb: nav.responseStart,
                  fcp,
                  transferKb: Math.round(transfer / 1024),
                });
              }, 1500);
            },
          ),
      );
      vitals[path] = m;
      // Budgets (lab, local network): LCP < 2.5 s, CLS < 0.1.
      expect(m.lcp, `LCP ${path}`).toBeLessThan(2500);
      expect(m.cls, `CLS ${path}`).toBeLessThan(0.1);
    }
    report.webVitals = vitals;
  });
});
