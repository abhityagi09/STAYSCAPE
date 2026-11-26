import { useState } from 'react';
import { BadgeCheck, Flag } from 'lucide-react';
import {
  REVIEW_CATEGORIES,
  REVIEW_CATEGORY_LABELS,
  REVIEW_REPORT_REASONS,
  type PublicReviewDto,
} from '@stayscape/shared';
import { Button, Modal, Pagination, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { normalizeApiError } from '@/lib/api/errors';
import { bookingsApi, useHotelReviews } from './api';

const REASON_LABELS: Record<(typeof REVIEW_REPORT_REASONS)[number], string> = {
  SPAM: 'Spam or advertising',
  OFFENSIVE: 'Offensive or abusive',
  PERSONAL_INFORMATION: 'Contains personal information',
  NOT_RELEVANT: 'Not about this stay',
  OTHER: 'Something else',
};

function ReportButton({ review }: { review: PublicReviewDto }) {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('SPAM');
  const [details, setDetails] = useState('');
  if (!isAuthenticated) return null;
  const submit = async () => {
    try {
      await bookingsApi.reportReview(review.id, reason, details);
      toast({ title: 'Thanks — our moderators will take a look', variant: 'success' });
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Could not report',
        description: normalizeApiError(e).message,
        variant: 'error',
      });
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="link"
        leftIcon={<Flag className="size-3.5" aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Report
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report this review"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()}>Report</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={REVIEW_REPORT_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }))}
          />
          <Textarea
            label="Details (optional)"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}

/** Verified reviews with category averages, sorting and owner responses. */
export function HotelReviews({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const query = useHotelReviews(slug, page, sort);
  if (query.isPending) return <Skeleton className="h-40 rounded-2xl" />;
  if (query.error)
    return <p className="text-sm text-fg-muted">Reviews could not be loaded right now.</p>;
  const { items, summary, pagination } = query.data;
  if (pagination.total === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-5">
      {Object.keys(summary.categories).length > 0 && (
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {REVIEW_CATEGORIES.map((c) => (
            <div key={c} className="flex items-center gap-3">
              <dt className="w-32 text-fg-muted">{REVIEW_CATEGORY_LABELS[c]}</dt>
              <dd className="flex flex-1 items-center gap-2">
                <span
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${((summary.categories[c] ?? 0) / 5) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums">
                  {(summary.categories[c] ?? 0).toFixed(1)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Select
        label="Sort reviews"
        value={sort}
        onChange={(e) => {
          setSort(e.target.value);
          setPage(1);
        }}
        options={[
          { value: 'recent', label: 'Most recent' },
          { value: 'highest', label: 'Highest rated' },
          { value: 'lowest', label: 'Lowest rated' },
        ]}
        containerClassName="w-52"
      />
      <ul className="flex flex-col gap-4">
        {items.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {r.authorName}{' '}
                <span className="font-normal text-fg-subtle">
                  · {r.roomTypeName} · stayed {r.stayMonth}
                </span>
              </span>
              <span className="font-semibold">★ {r.overall.toFixed(1)}</span>
            </div>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-success">
              <BadgeCheck className="size-3.5" aria-hidden="true" /> Verified stay
            </p>
            <p className="mt-2 font-medium">{r.title}</p>
            <p className="text-fg-muted">{r.body}</p>
            {r.photos.length > 0 && (
              <div className="mt-3 flex gap-2">
                {r.photos.map((p) => (
                  <div key={p.id} className="size-20 overflow-hidden rounded-lg">
                    <ResponsiveImage image={p} sizes="80px" className="size-full" />
                  </div>
                ))}
              </div>
            )}
            {r.response && (
              <p className="mt-3 rounded-lg bg-surface-muted p-3">
                <span className="font-medium">Response from the property:</span> {r.response.body}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-fg-subtle">
              {new Date(r.createdAt).toLocaleDateString()}
              {r.editedAt ? ' · edited' : ''}
              <ReportButton review={r} />
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} />
    </div>
  );
}
