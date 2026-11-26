import { Router } from 'express';
import type { Container } from '@/container';

/**
 * Public SEO endpoints (no personal data):
 *   GET /api/v1/seo/head/*path   <head> fragment for a web path (used by the nginx SSI include)
 *   GET /api/v1/seo/body/*path   crawlable HTML summary for #root (hotel and content pages)
 *   GET /sitemap.xml, /robots.txt  served at the site root through nginx
 */
export function createSeoRouter(container: Container): Router {
  const router = Router();
  const { seo } = container.services;
  const target = (req: { params: Record<string, unknown>; url: string }) => {
    const segments = req.params.path;
    const path = `/${Array.isArray(segments) ? segments.join('/') : ''}`;
    const query = new URLSearchParams(req.url.split('?')[1] ?? '');
    return { path, query };
  };
  const cache = (res: { setHeader: (k: string, v: string) => void }) =>
    res.setHeader('Cache-Control', 'public, max-age=300');

  router.get(['/head', '/head/*path'], async (req, res) => {
    const { path, query } = target(req);
    const page = await seo.page(path, query);
    cache(res);
    res.type('text/html; charset=utf-8').send(seo.head(page));
  });
  router.get(['/body', '/body/*path'], async (req, res) => {
    const { path, query } = target(req);
    const page = await seo.page(path, query);
    cache(res);
    res.type('text/html; charset=utf-8').send(page.body ?? '');
  });
  return router;
}

export function createSitemapRouter(container: Container): Router {
  const router = Router();
  router.get('/sitemap.xml', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(await container.services.seo.sitemap());
  });
  router.get('/robots.txt', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(container.services.seo.robots());
  });
  return router;
}
