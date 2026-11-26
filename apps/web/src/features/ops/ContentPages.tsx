import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  CONTENT_TYPES,
  type AdminContentDto,
  type ContentType,
  type PublicContentDto,
} from '@stayscape/shared';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { http, unwrap } from '@/lib/api/client';
import { normalizeApiError } from '@/lib/api/errors';
import { useI18n } from '@/lib/i18n';
import { api, useApiMutation, useApiQuery, type Page } from './api';
import { QueryState, SectionCard, StatusBadge, fmtDate, fmtDateTime } from './components';
import { tr, trf } from '@/lib/tr';

// ------------------------------------------------------------------ safe Markdown
/** Inline: **bold**, *italic*, `code`, [text](/path or https://). Everything else is plain text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`'))
      out.push(
        <code key={k} className="rounded bg-surface-muted px-1">
          {t.slice(1, -1)}
        </code>,
      );
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t) ?? [];
      // Only site paths and https links are rendered as links; anything else stays text.
      if (href && /^\/(?!\/)/.test(href))
        out.push(
          <Link key={k} to={href} className="text-primary underline">
            {label}
          </Link>,
        );
      else if (href && /^https:\/\//.test(href))
        out.push(
          <a
            key={k}
            href={href}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="text-primary underline"
          >
            {label}
          </a>,
        );
      else out.push(t);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block-level Markdown (headings, paragraphs, lists, quotes) as React elements — raw HTML is never rendered. */
export function SafeMarkdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-4 leading-relaxed">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        const lines = b.split('\n');
        const h = /^(#{1,4})\s+(.*)$/.exec(b);
        if (h && lines.length === 1) {
          const level = Math.min(4, Math.max(2, h[1]!.length)); // the page title is the only h1
          const cls = [
            '',
            '',
            'text-2xl font-display',
            'text-xl font-semibold',
            'text-lg font-semibold',
          ][level];
          const Tag = `h${level}` as 'h2';
          return (
            <Tag key={k} className={cls}>
              {inline(h[2]!, k)}
            </Tag>
          );
        }
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={k} className="list-disc pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''), `${k}-${j}`)}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
          return (
            <ol key={k} className="list-decimal pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), `${k}-${j}`)}</li>
              ))}
            </ol>
          );
        if (lines.every((l) => l.startsWith('>')))
          return (
            <blockquote key={k} className="border-l-4 border-border pl-4 text-fg-muted">
              {inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), k)}
            </blockquote>
          );
        return (
          <p key={k}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ public pages
function useDocumentMeta(c?: PublicContentDto) {
  useEffect(() => {
    if (!c) return;
    document.title = `${c.seo.title || c.title} · STAYSCAPE`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', c.seo.description || c.summary);
    let robots = document.querySelector('meta[name="robots"]');
    if (c.seo.noindex) {
      if (!robots) {
        robots = document.createElement('meta');
        robots.setAttribute('name', 'robots');
        document.head.appendChild(robots);
      }
      robots.setAttribute('content', 'noindex');
    } else robots?.remove();
  }, [c]);
}

function Article({ c }: { c: PublicContentDto }) {
  useDocumentMeta(c);
  const img = c.images[0];
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl text-fg">{c.title}</h1>
        {c.summary && <p className="text-lg text-fg-muted">{c.summary}</p>}
        {c.publishedAt && (
          <p className="text-sm text-fg-subtle">
            {tr('Published')} {fmtDate(c.publishedAt)}
          </p>
        )}
      </header>
      {img && (
        <img
          src={img.variants.lg}
          alt={img.alt}
          width={img.width}
          height={img.height}
          className="w-full rounded-2xl object-cover"
        />
      )}
      <SafeMarkdown source={c.body} />
      {c.cta && (
        <Link
          to={c.cta.href.startsWith('/') ? c.cta.href : '/'}
          className="self-start rounded-full bg-primary px-5 py-3 text-primary-fg"
        >
          {c.cta.label}
        </Link>
      )}
    </article>
  );
}

/** /guides/:slug, /blog/:slug, /legal/:slug — published content only. */
export function ContentEntryPage({ type }: { type: 'GUIDE' | 'BLOG' | 'LEGAL' }) {
  const { slug = '' } = useParams();
  const { language } = useI18n();
  const q = useApiQuery<PublicContentDto>(
    ['content', type, slug],
    `/content/${type.toLowerCase()}/${slug}`,
    { locale: language },
  );
  return <QueryState query={q}>{q.data && <Article c={q.data} />}</QueryState>;
}

/** /content/preview/:token — draft preview for editors (never indexed). */
export function ContentPreviewPage() {
  const { token = '' } = useParams();
  const q = useApiQuery<PublicContentDto>(
    ['content', 'preview', token],
    `/content/preview/${token}`,
  );
  return (
    <QueryState query={q}>
      <Alert tone="warning" title={tr('Preview')} className="mx-auto mt-6 max-w-3xl">
        {tr('This is an unpublished draft. The link expires after one hour.')}
      </Alert>
      {q.data && <Article c={q.data} />}
    </QueryState>
  );
}

export function GuidesIndexPage() {
  const { language } = useI18n();
  const q = useApiQuery<PublicContentDto[]>(['content', 'guides'], '/content', {
    type: 'GUIDE',
    locale: language,
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <PageHeader title={tr('Travel guides')} />
      <QueryState query={q}>
        {q.data?.length ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {q.data.map((g) => (
              <li key={g.slug} className="rounded-2xl border border-border p-5">
                <Link to={`/guides/${g.slug}`} className="font-display text-xl hover:underline">
                  {g.title}
                </Link>
                <p className="text-sm text-fg-muted">{g.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={tr('No guides published yet')} />
        )}
      </QueryState>
    </div>
  );
}

export function FaqPage() {
  const { language } = useI18n();
  const q = useApiQuery<PublicContentDto[]>(['content', 'faq'], '/content', {
    type: 'FAQ',
    locale: language,
    limit: 50,
  });
  const groups = new Map<string, PublicContentDto[]>();
  for (const f of q.data ?? [])
    groups.set(f.faqCategory ?? 'General', [...(groups.get(f.faqCategory ?? 'General') ?? []), f]);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <PageHeader title={tr('Frequently asked questions')} />
      <QueryState query={q}>
        {groups.size ? (
          [...groups].map(([cat, items]) => (
            <section key={cat} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold capitalize">{cat}</h2>
              {items.map((f) => (
                <details key={f.slug} className="rounded-xl border border-border p-4">
                  <summary className="cursor-pointer font-medium">{f.title}</summary>
                  <div className="mt-2 text-sm">
                    <SafeMarkdown source={f.body} />
                  </div>
                </details>
              ))}
            </section>
          ))
        ) : (
          <EmptyState title={tr('No questions published yet')} />
        )}
      </QueryState>
    </div>
  );
}

/** Home-page promo banners from the CMS (renders nothing when none are live). */
export function CmsBanners() {
  const { language } = useI18n();
  const q = useApiQuery<PublicContentDto[]>(['content', 'banners'], '/content', {
    type: 'BANNER',
    locale: language,
    limit: 3,
  });
  if (!q.data?.length) return null;
  return (
    <section
      aria-label={tr('Promotions')}
      className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 md:grid-cols-3"
    >
      {q.data.map((b) => (
        <div key={b.slug} className="flex flex-col gap-2 rounded-2xl bg-primary-soft p-5">
          <p className="font-display text-xl text-fg">{b.title}</p>
          {b.summary && <p className="text-sm text-fg-muted">{b.summary}</p>}
          {b.cta && (
            <Link
              to={b.cta.href.startsWith('/') ? b.cta.href : '/'}
              className="self-start text-sm font-medium text-primary underline"
            >
              {b.cta.label}
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ admin editor
const blank = {
  type: 'GUIDE' as ContentType,
  locale: 'en',
  slug: '',
  title: '',
  summary: '',
  body: '',
  ctaLabel: '',
  ctaHref: '',
  faqCategory: '',
  tags: '',
  seoTitle: '',
  seoDescription: '',
  noindex: false,
};
type Form = typeof blank;
const fromEntry = (e: AdminContentDto): Form => ({
  type: e.type,
  locale: e.locale,
  slug: e.slug,
  title: e.draft.title,
  summary: e.draft.summary,
  body: e.draft.body,
  ctaLabel: e.draft.cta?.label ?? '',
  ctaHref: e.draft.cta?.href ?? '',
  faqCategory: e.draft.faqCategory ?? '',
  tags: e.draft.tags.join(', '),
  seoTitle: e.draft.seo.title,
  seoDescription: e.draft.seo.description,
  noindex: e.draft.seo.noindex,
});
const bodyOf = (f: Form, imageIds: string[] = [], imageAlts: string[] = []) => ({
  title: f.title,
  summary: f.summary,
  body: f.body,
  imageIds,
  imageAlts,
  cta: f.ctaLabel && f.ctaHref ? { label: f.ctaLabel, href: f.ctaHref } : null,
  faqCategory: f.faqCategory || null,
  tags: f.tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
  seo: { title: f.seoTitle, description: f.seoDescription, noindex: f.noindex },
});

function Editor({ entry, onDone }: { entry: AdminContentDto | null; onDone: () => void }) {
  const [f, setF] = useState<Form>(entry ? fromEntry(entry) : blank);
  const [publishAt, setPublishAt] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  // Images are kept with their alt text as one list, so ids and alts can never drift apart.
  const [images, setImages] = useState<Array<{ id: string; alt: string; url: string }>>(
    entry ? entry.draft.images.map((i) => ({ id: i.id, alt: i.alt, url: i.variants.sm })) : [],
  );
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const img = await unwrap<{ id: string; variants: { sm: string } }>(
        http.post('/admin/content/images', fd),
      );
      setImages((list) => [...list, { id: img.id, alt: '', url: img.variants.sm }]);
    } catch (e) {
      fail('Upload failed')(e);
    } finally {
      setUploading(false);
    }
  };
  const { toast } = useToast();
  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: normalizeApiError(e).message, variant: 'error' });
  const key = [['admin', 'content']];
  const save = useApiMutation(
    () =>
      entry
        ? api.put<AdminContentDto>(`/admin/content/${entry.id}`, {
            ...bodyOf(
              f,
              images.map((i) => i.id),
              images.map((i) => i.alt),
            ),
            version: entry.version,
          })
        : api.post<AdminContentDto>('/admin/content', {
            ...bodyOf(
              f,
              images.map((i) => i.id),
              images.map((i) => i.alt),
            ),
            type: f.type,
            locale: f.locale,
            slug: f.slug,
          }),
    key,
  );
  const act = useApiMutation(
    (v: { path: string; body?: object }) =>
      api.post<AdminContentDto | { token: string }>(
        `/admin/content/${entry?.id}/${v.path}`,
        v.body,
      ),
    key,
  );
  const revisions = useApiQuery<
    Array<{ id: string; version: number; action: string; title: string; createdAt: string }>
  >(['admin', 'content', 'revisions'], entry ? `/admin/content/${entry.id}/revisions` : null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <SectionCard
      title={entry ? trf('Edit: {0}', [entry.draft.title]) : tr('New content')}
      description={
        entry && (
          <>
            {tr('State:')} <StatusBadge status={entry.state} /> {tr('· version')} {entry.version}
            {entry.hasUnpublishedChanges && tr(' · unpublished changes')}
          </>
        )
      }
      actions={
        <Button size="sm" variant="ghost" onClick={onDone}>
          {tr('Close')}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, {
            onSuccess: () => {
              toast({ title: tr('Draft saved'), variant: 'success' });
              onDone();
            },
            onError: fail('Could not save'),
          });
        }}
      >
        <div className="flex flex-wrap gap-3">
          <Select
            label={tr('Type')}
            value={f.type}
            disabled={Boolean(entry)}
            onChange={set('type')}
            options={CONTENT_TYPES.map((t) => ({
              value: t,
              label: t.replace('_', ' ').toLowerCase(),
            }))}
            containerClassName="w-52"
          />
          <Select
            label={tr('Language')}
            value={f.locale}
            disabled={Boolean(entry)}
            onChange={set('locale')}
            options={[
              { value: 'en', label: tr('English') },
              { value: 'hi', label: tr('Hindi') },
            ]}
            containerClassName="w-36"
          />
          <Input
            label={tr('Slug')}
            value={f.slug}
            disabled={Boolean(entry)}
            onChange={set('slug')}
            containerClassName="w-64"
          />
        </div>
        <Input label={tr('Title')} value={f.title} onChange={set('title')} />
        <Input label={tr('Summary')} value={f.summary} onChange={set('summary')} />
        <Textarea
          label={tr('Body (Markdown: headings, lists, **bold**, links)')}
          value={f.body}
          onChange={set('body')}
          rows={12}
        />
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{tr('Images')}</legend>
          {images.map((img, i) => (
            <div key={img.id} className="flex flex-wrap items-end gap-2">
              <img src={img.url} alt="" className="h-14 w-20 rounded object-cover" />
              <Input
                label={trf('Alt text for image {0} (required)', [i + 1])}
                value={img.alt}
                onChange={(e) =>
                  setImages(
                    images.map((x) => (x.id === img.id ? { ...x, alt: e.target.value } : x)),
                  )
                }
                containerClassName="w-80"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setImages(images.filter((x) => x.id !== img.id))}
              >
                {tr('Remove')}
              </Button>
            </div>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            {tr('Add an image (JPEG, PNG, WebP or AVIF, up to 10 MB)')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={uploading || images.length >= 10}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Input
            label={tr('Button label')}
            value={f.ctaLabel}
            onChange={set('ctaLabel')}
            containerClassName="w-48"
          />
          <Input
            label="Button link (/path or https://)"
            value={f.ctaHref}
            onChange={set('ctaHref')}
            containerClassName="w-72"
          />
          {f.type === 'FAQ' && (
            <Input
              label={tr('FAQ group')}
              value={f.faqCategory}
              onChange={set('faqCategory')}
              containerClassName="w-48"
            />
          )}
          <Input
            label={tr('Tags (comma separated)')}
            value={f.tags}
            onChange={set('tags')}
            containerClassName="w-72"
          />
        </div>
        <fieldset className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{tr('Search engines')}</legend>
          <Input
            label={tr('SEO title')}
            value={f.seoTitle}
            onChange={set('seoTitle')}
            containerClassName="w-72"
          />
          <Input
            label={tr('SEO description')}
            value={f.seoDescription}
            onChange={set('seoDescription')}
            containerClassName="w-96"
          />
          <Checkbox
            label={tr('Hide from search engines')}
            checked={f.noindex}
            onChange={(e) => setF({ ...f, noindex: e.target.checked })}
          />
        </fieldset>
        <Button
          type="submit"
          className="self-start"
          loading={save.isPending}
          disabled={
            f.title.length < 2 ||
            (!entry && f.slug.length < 2) ||
            images.some((i) => i.alt.trim().length < 2)
          }
        >
          {tr('Save draft')}
        </Button>
      </form>
      {entry && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              type="datetime-local"
              label={tr('Publish at (blank = now)')}
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              containerClassName="w-60"
            />
            <Button
              onClick={() =>
                act.mutate(
                  {
                    path: 'publish',
                    body: { publishAt: publishAt ? new Date(publishAt).toISOString() : null },
                  },
                  {
                    onSuccess: () => {
                      toast({ title: publishAt ? 'Scheduled' : 'Published', variant: 'success' });
                      onDone();
                    },
                    onError: fail('Could not publish'),
                  },
                )
              }
            >
              {publishAt ? tr('Schedule') : tr('Publish')}
            </Button>
            {entry.publishedAt && (
              <Button
                variant="outline"
                onClick={() =>
                  act.mutate(
                    { path: 'unpublish' },
                    { onSuccess: onDone, onError: fail('Could not unpublish') },
                  )
                }
              >
                {tr('Unpublish')}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                act.mutate(
                  { path: 'preview' },
                  {
                    onSuccess: (r) =>
                      setPreview(`/content/preview/${(r as { token: string }).token}`),
                    onError: fail('Could not create a preview'),
                  },
                )
              }
            >
              {tr('Preview link')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                act.mutate(
                  { path: entry.archivedAt ? 'restore' : 'archive' },
                  { onSuccess: onDone, onError: fail('Could not change') },
                )
              }
            >
              {entry.archivedAt ? tr('Restore') : tr('Archive')}
            </Button>
          </div>
          {preview && (
            <Alert tone="info" title={tr('Preview ready')}>
              <Link to={preview} className="underline" target="_blank">
                {tr('Open the draft preview')}
              </Link>{' '}
              {tr('(valid for one hour)')}
            </Alert>
          )}
          <QueryState query={revisions}>
            <ol className="flex flex-col gap-1 text-sm" aria-label={tr('Revision history')}>
              {revisions.data?.map((r) => (
                <li key={r.id}>
                  {fmtDateTime(r.createdAt)} · {r.action.toLowerCase()} {tr('· v')}
                  {r.version} · {r.title}
                </li>
              ))}
            </ol>
          </QueryState>
        </div>
      )}
    </SectionCard>
  );
}

export function AdminContentPage() {
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [editing, setEditing] = useState<AdminContentDto | 'new' | null>(null);
  const list = useApiQuery<Page<AdminContentDto>>(['admin', 'content'], '/admin/content', {
    type: type || undefined,
    state: state || undefined,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Content')}
        description={tr(
          'Banners, guides, blog posts, FAQs and legal pages. Edits stay in draft until you publish them.',
        )}
        actions={<Button onClick={() => setEditing('new')}>{tr('New content')}</Button>}
      />
      {editing && (
        <Editor
          key={editing === 'new' ? 'new' : editing.id}
          entry={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="flex flex-wrap gap-3">
        <Select
          label={tr('Type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: '', label: tr('All types') },
            ...CONTENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ').toLowerCase() })),
          ]}
          containerClassName="w-52"
        />
        <Select
          label={tr('State')}
          value={state}
          onChange={(e) => setState(e.target.value)}
          options={['', 'DRAFT', 'SCHEDULED', 'LIVE', 'EXPIRED', 'ARCHIVED'].map((s) => ({
            value: s,
            label: s ? s.toLowerCase() : 'Any state',
          }))}
          containerClassName="w-44"
        />
      </div>
      <DataTable
        caption={tr('Content entries')}
        rows={list.data?.items}
        loading={list.isPending}
        getRowId={(e) => e.id}
        empty={<EmptyState compact title={tr('No content yet')} />}
        columns={[
          {
            id: 't',
            header: tr('Title'),
            cell: (e) => (
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => setEditing(e)}
              >
                {e.draft.title}
                <span className="block text-xs text-fg-subtle">
                  /{e.slug} · {e.locale}
                </span>
              </button>
            ),
          },
          { id: 'y', header: tr('Type'), cell: (e) => e.type.replace('_', ' ').toLowerCase() },
          {
            id: 's',
            header: tr('State'),
            cell: (e) => (
              <span className="flex flex-col gap-1">
                <StatusBadge status={e.state} />
                {e.hasUnpublishedChanges && e.state !== 'DRAFT' && (
                  <span className="text-xs text-warning">{tr('Unpublished changes')}</span>
                )}
              </span>
            ),
          },
          {
            id: 'p',
            header: tr('Publish'),
            cell: (e) => (e.publishAt ? fmtDateTime(e.publishAt) : '—'),
          },
          { id: 'u', header: tr('Updated'), cell: (e) => fmtDateTime(e.updatedAt) },
        ]}
      />
    </div>
  );
}
