import type { HotelDetailDto, PublicContentDto } from '@stayscape/shared';
import { PROPERTY_TYPE_LABELS } from '@stayscape/shared';
import { ContentEntryModel } from '@/modules/content/content.models';
import { stateFilter, type ContentService } from '@/modules/content/content.service';
import { HotelModel } from '@/modules/hotels/hotel.model';
import type { SearchService } from '@/modules/search/search.service';

const SITE = 'STAYSCAPE';
const DEFAULT_TITLE = 'STAYSCAPE — Stays worth the journey';
const DEFAULT_DESCRIPTION =
  'Discover and book verified hotels, resorts, villas and homestays across India with transparent prices.';

/** Paths that must never be indexed (private, transactional or personal). */
const PRIVATE = [
  /^\/account(\/|$)/,
  /^\/partner(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/trips(\/|$)/,
  /^\/compare(\/|$)/,
  /^\/(login|register|forgot-password|reset-password|verify-email|403)(\/|$)/,
  /^\/(wishlists|trips)\/shared\//,
  /^\/content\/preview\//,
];

const CONTENT_ROUTES: Record<string, 'GUIDE' | 'BLOG' | 'LEGAL'> = {
  guides: 'GUIDE',
  blog: 'BLOG',
  legal: 'LEGAL',
};

const STATIC: Record<string, { title: string; description: string }> = {
  '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  '/hotels': {
    title: `Hotels and stays · ${SITE}`,
    description:
      'Search verified hotels, resorts, villas and homestays with live prices and clear policies.',
  },
  '/guides': {
    title: `Travel guides · ${SITE}`,
    description: 'Destination guides and seasonal travel notes from the STAYSCAPE team.',
  },
  '/help/faq': {
    title: `Help and FAQ · ${SITE}`,
    description: 'Answers about booking, payments, cancellations and refunds on STAYSCAPE.',
  },
  '/partners': {
    title: `List your property · ${SITE}`,
    description:
      'Partner with STAYSCAPE: transparent onboarding, team permissions, inventory and pricing tools.',
  },
  '/terms': {
    title: `Terms of service · ${SITE}`,
    description: 'The terms that apply to using STAYSCAPE.',
  },
  '/privacy': {
    title: `Privacy policy · ${SITE}`,
    description: 'How STAYSCAPE collects, uses and protects personal data.',
  },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/** JSON-LD inside <script>: escape the characters that could close the element. */
function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface SeoPage {
  status: 200 | 404;
  title: string;
  description: string;
  canonical: string | null;
  noindex: boolean;
  image: string | null;
  type: 'website' | 'article' | 'hotel';
  structuredData: unknown[];
  /** Crawlable HTML summary placed inside #root; React replaces it when the app starts. */
  body: string | null;
}

/**
 * Server-generated metadata for the client-rendered web app. nginx injects head() into
 * index.html with a server-side include (infrastructure/nginx/default.conf), so crawlers and
 * link previews get the right title, description, canonical URL, Open Graph tags and JSON-LD
 * without executing JavaScript. Only published, non-personal data is ever used.
 */
export class SeoService {
  constructor(
    private readonly deps: { search: SearchService; content: ContentService; webAppUrl: string },
  ) {}

  private abs(path: string): string {
    return new URL(path, this.deps.webAppUrl).toString();
  }
  private image(url: string | undefined | null): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : this.abs(url);
  }

  async page(rawPath: string, query: URLSearchParams = new URLSearchParams()): Promise<SeoPage> {
    const path = (rawPath.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
    const base: SeoPage = {
      status: 200,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      canonical: this.abs(path),
      noindex: false,
      image: null,
      type: 'website',
      structuredData: [],
      body: null,
    };
    if (PRIVATE.some((re) => re.test(path)))
      return { ...base, canonical: null, noindex: true, title: SITE };

    if (path === '/') {
      return {
        ...base,
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: SITE,
            url: this.abs('/'),
            potentialAction: {
              '@type': 'SearchAction',
              target: `${this.abs('/hotels')}?destination={search_term_string}`,
              'query-input': 'required name=search_term_string',
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: SITE,
            url: this.abs('/'),
          },
        ],
      };
    }
    if (path === '/hotels') {
      // Only the destination parameter defines a distinct, indexable listing; dates/filters do not.
      const destination = query.get('destination')?.trim().slice(0, 80);
      if (destination)
        return {
          ...base,
          title: `Stays in ${destination} · ${SITE}`,
          description: `Compare verified hotels and stays in ${destination} with live prices, taxes shown upfront and clear cancellation policies.`,
          canonical: `${this.abs('/hotels')}?destination=${encodeURIComponent(destination)}`,
        };
      return { ...base, ...STATIC['/hotels']! };
    }
    const hotel = /^\/hotels\/([a-z0-9-]{3,140})$/.exec(path);
    if (hotel) return this.hotelPage(hotel[1]!, base);
    const content = /^\/(guides|blog|legal)\/([a-z0-9-]{2,100})$/.exec(path);
    if (content) return this.contentPage(CONTENT_ROUTES[content[1]!]!, content[2]!, path, base);
    const known = STATIC[path];
    if (known) return { ...base, ...known };
    // Unknown public path: the SPA renders its own 404; keep it out of the index.
    return {
      ...base,
      status: 404,
      canonical: null,
      noindex: true,
      title: `Page not found · ${SITE}`,
    };
  }

  private async hotelPage(slug: string, base: SeoPage): Promise<SeoPage> {
    let h: HotelDetailDto;
    try {
      h = await this.deps.search.detail(slug);
    } catch {
      return {
        ...base,
        status: 404,
        canonical: null,
        noindex: true,
        title: `Stay not found · ${SITE}`,
      };
    }
    const type = PROPERTY_TYPE_LABELS[h.propertyType] ?? 'Stay';
    const place = [h.city, h.state].filter(Boolean).join(', ');
    const description = clip(h.shortDescription || h.description || `${type} in ${place}.`, 158);
    const cover = h.coverImage ?? h.images[0] ?? null;
    const ld: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': h.propertyType === 'RESORT' ? 'Resort' : 'Hotel',
      name: h.name,
      description,
      url: this.abs(`/hotels/${h.slug}`),
      address: {
        '@type': 'PostalAddress',
        streetAddress: [h.address.line1, h.address.line2].filter(Boolean).join(', '),
        addressLocality: h.city,
        addressRegion: h.state,
        postalCode: h.postalCode,
        addressCountry: h.country,
      },
      geo: { '@type': 'GeoCoordinates', latitude: h.location.lat, longitude: h.location.lng },
      checkinTime: h.checkInTime,
      checkoutTime: h.checkOutTime,
      amenityFeature: h.amenityDetails.slice(0, 30).map((a) => ({
        '@type': 'LocationFeatureSpecification',
        name: a.name,
        value: true,
      })),
      ...(cover ? { image: this.image(cover.variants.lg) } : {}),
      ...(h.starCategory ? { starRating: { '@type': 'Rating', ratingValue: h.starCategory } } : {}),
    };
    // Only verified guest reviews qualify as an aggregate rating; seeded sample ratings never do.
    if (h.ratingSummary.source === 'REVIEWS' && h.ratingSummary.count > 0)
      ld.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: h.ratingSummary.average,
        reviewCount: h.ratingSummary.count,
        bestRating: 5,
      };
    const breadcrumbs = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE, item: this.abs('/') },
        {
          '@type': 'ListItem',
          position: 2,
          name: h.city,
          item: `${this.abs('/hotels')}?destination=${encodeURIComponent(h.city)}`,
        },
        { '@type': 'ListItem', position: 3, name: h.name, item: this.abs(`/hotels/${h.slug}`) },
      ],
    };
    const rooms = h.roomTypes
      .map((r) => `<li>${escapeHtml(r.name)} — sleeps ${r.maximumOccupancy}</li>`)
      .join('');
    const body =
      `<main><h1>${escapeHtml(h.name)}</h1>` +
      `<p>${escapeHtml(type)} in ${escapeHtml(place)}</p>` +
      `<p>${escapeHtml(clip(h.description || h.shortDescription, 600))}</p>` +
      (rooms ? `<h2>Rooms</h2><ul>${rooms}</ul>` : '') +
      `<p><a href="/hotels?destination=${encodeURIComponent(h.city)}">More stays in ${escapeHtml(h.city)}</a></p></main>`;
    return {
      ...base,
      title: `${h.name}, ${h.city} · ${SITE}`,
      description,
      canonical: this.abs(`/hotels/${h.slug}`),
      image: cover ? this.image(cover.variants.lg) : null,
      type: 'hotel',
      structuredData: [ld, breadcrumbs],
      body,
    };
  }

  private async contentPage(
    type: 'GUIDE' | 'BLOG' | 'LEGAL',
    slug: string,
    path: string,
    base: SeoPage,
  ): Promise<SeoPage> {
    let c: PublicContentDto;
    try {
      c = await this.deps.content.publicEntry(type, slug, 'en');
    } catch {
      return {
        ...base,
        status: 404,
        canonical: null,
        noindex: true,
        title: `Page not found · ${SITE}`,
      };
    }
    const description = clip(c.seo.description || c.summary, 158);
    return {
      ...base,
      title: `${c.seo.title || c.title} · ${SITE}`,
      description,
      noindex: c.seo.noindex,
      canonical: c.seo.noindex ? null : this.abs(path),
      image: c.images[0] ? this.image(c.images[0].variants.lg) : null,
      type: 'article',
      structuredData:
        type === 'LEGAL'
          ? []
          : [
              {
                '@context': 'https://schema.org',
                '@type': type === 'BLOG' ? 'BlogPosting' : 'Article',
                headline: clip(c.title, 110),
                description,
                ...(c.publishedAt ? { datePublished: c.publishedAt } : {}),
                dateModified: c.updatedAt,
                mainEntityOfPage: this.abs(path),
                publisher: { '@type': 'Organization', name: SITE },
              },
            ],
      body: `<main><h1>${escapeHtml(c.title)}</h1><p>${escapeHtml(clip(c.summary, 600))}</p></main>`,
    };
  }

  /** HTML fragment for <head>. Every value is escaped; JSON-LD is script-safe. */
  head(page: SeoPage): string {
    const t = escapeHtml(page.title);
    const d = escapeHtml(page.description);
    const lines = [
      `<title>${t}</title>`,
      `<meta name="description" content="${d}" />`,
      page.noindex
        ? '<meta name="robots" content="noindex, nofollow" />'
        : '<meta name="robots" content="index, follow, max-image-preview:large" />',
    ];
    if (page.canonical) lines.push(`<link rel="canonical" href="${escapeHtml(page.canonical)}" />`);
    if (!page.noindex) {
      lines.push(
        `<meta property="og:site_name" content="${SITE}" />`,
        `<meta property="og:type" content="${page.type === 'article' ? 'article' : 'website'}" />`,
        `<meta property="og:title" content="${t}" />`,
        `<meta property="og:description" content="${d}" />`,
        `<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" />`,
      );
      if (page.canonical)
        lines.push(`<meta property="og:url" content="${escapeHtml(page.canonical)}" />`);
      if (page.image)
        lines.push(`<meta property="og:image" content="${escapeHtml(page.image)}" />`);
      for (const ld of page.structuredData)
        lines.push(`<script type="application/ld+json">${jsonLd(ld)}</script>`);
    }
    return lines.join('\n    ');
  }

  async sitemap(): Promise<string> {
    const urls: Array<{ loc: string; lastmod?: string }> = Object.keys(STATIC).map((p) => ({
      loc: this.abs(p),
    }));
    const hotels = await HotelModel.find(
      { publicationStatus: 'PUBLISHED' },
      { slug: 1, city: 1, updatedAt: 1 },
    )
      .sort({ updatedAt: -1 })
      .limit(45_000)
      .lean<Array<{ slug: string; city: string; updatedAt: Date }>>();
    for (const h of hotels)
      urls.push({
        loc: this.abs(`/hotels/${h.slug}`),
        lastmod: h.updatedAt.toISOString().slice(0, 10),
      });
    for (const city of [...new Set(hotels.map((h) => h.city))].sort())
      urls.push({ loc: `${this.abs('/hotels')}?destination=${encodeURIComponent(city)}` });
    const now = new Date();
    const content = await ContentEntryModel.find(
      {
        type: { $in: ['GUIDE', 'BLOG', 'LEGAL'] },
        locale: 'en',
        'published.seo.noindex': { $ne: true },
        ...stateFilter('LIVE', now),
      },
      { type: 1, slug: 1, updatedAt: 1 },
    ).lean<Array<{ type: string; slug: string; updatedAt: Date }>>();
    const prefix: Record<string, string> = { GUIDE: 'guides', BLOG: 'blog', LEGAL: 'legal' };
    for (const c of content)
      urls.push({
        loc: this.abs(`/${prefix[c.type]}/${c.slug}`),
        lastmod: c.updatedAt.toISOString().slice(0, 10),
      });
    const body = urls
      .map(
        (u) =>
          `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  }

  robots(): string {
    return [
      'User-agent: *',
      'Allow: /',
      ...[
        '/account',
        '/partner',
        '/admin',
        '/checkout',
        '/trips',
        '/compare',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
        '/wishlists/shared/',
        '/trips/shared/',
        '/content/preview/',
        '/api/',
      ].map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${this.abs('/sitemap.xml')}`,
      '',
    ].join('\n');
  }
}
