import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Heart,
  ImagePlus,
  LifeBuoy,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import {
  REVIEW_CATEGORIES,
  REVIEW_CATEGORY_LABELS,
  REVIEW_MAX_PHOTOS,
  TICKET_CATEGORIES,
  type ImageDto,
  type MyReviewDto,
  type ReviewRatingsDto,
  type TicketCategory,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DatePicker,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  PageSpinner,
  Select,
  Textarea,
  todayIsoDate,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { PreferencesForm } from '@/features/account/components/PreferencesForm';
import { ChangePasswordCard, SessionsCard } from '@/features/account/components/SecuritySettings';
import { HotelCard, ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { normalizeApiError } from '@/lib/api/errors';
import {
  bookingsApi,
  downloadFile,
  supportApi,
  useEligibleReviews,
  useMyReviews,
  useWishlistMutation,
  wishlistsApi,
} from '../api';
import { formatInstant, formatStayDate } from '../components';

// ---------------------------------------------------------------- reviews
function StarInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex items-center justify-between gap-3">
      <legend className="sr-only">{label}</legend>
      <span className="text-sm" aria-hidden="true">
        {label}
      </span>
      <span className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={`${label}: ${n} of 5`}
            />
            <Star
              className={`size-6 peer-focus-visible:outline-2 peer-focus-visible:outline-ring ${n <= value ? 'fill-gold-500 text-gold-500' : 'text-border-strong'}`}
              aria-hidden="true"
            />
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/** Create (from a booking) or edit (an existing review) a verified review. */
export function ReviewEditor({
  bookingReference,
  hotelName,
  review,
  onClose,
  onSaved,
}: {
  bookingReference?: string;
  hotelName: string;
  review?: MyReviewDto;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ratings, setRatings] = useState<ReviewRatingsDto>(
    review?.ratings ?? {
      cleanliness: 0,
      staff: 0,
      location: 0,
      comfort: 0,
      facilities: 0,
      value: 0,
    },
  );
  const [title, setTitle] = useState(review?.title ?? '');
  const [body, setBody] = useState(review?.body ?? '');
  const [photos, setPhotos] = useState<ImageDto[]>(review?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () => {
      const input = { ratings, title, body, photoIds: photos.map((p) => p.id) };
      return review
        ? bookingsApi.updateReview(review.id, input)
        : bookingsApi.createReview(bookingReference!, input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      void qc.invalidateQueries({ queryKey: ['booking'] });
      toast({ title: review ? 'Review updated' : 'Thanks for your review', variant: 'success' });
      onSaved?.();
      onClose();
    },
  });
  const complete =
    REVIEW_CATEGORIES.every((c) => ratings[c] > 0) &&
    title.trim().length >= 3 &&
    body.trim().length >= 20;
  const err = save.error ? normalizeApiError(save.error) : null;
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const image = await bookingsApi.uploadReviewPhoto(file);
      setPhotos((p) => [...p, image]);
    } catch (e) {
      toast({
        title: 'Photo not added',
        description: normalizeApiError(e).message,
        variant: 'error',
      });
    } finally {
      setUploading(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={review ? 'Edit your review' : `Review ${hotelName}`}
      description="Reviews are verified: only guests who completed a stay can write one."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!complete} onClick={() => save.mutate()}>
            {review ? 'Save changes' : 'Publish review'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-8">
          {REVIEW_CATEGORIES.map((c) => (
            <StarInput
              key={c}
              label={REVIEW_CATEGORY_LABELS[c]}
              value={ratings[c]}
              onChange={(v) => setRatings((r) => ({ ...r, [c]: v }))}
            />
          ))}
        </div>
        <Input
          label="Title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          error={err?.firstFieldError('title') ?? undefined}
        />
        <Textarea
          label="Your review"
          rows={5}
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          hint="At least 20 characters. Please don't include personal information."
          error={err?.firstFieldError('body') ?? undefined}
        />
        <div className="flex flex-wrap items-center gap-3">
          {photos.map((p) => (
            <div key={p.id} className="relative size-20 overflow-hidden rounded-lg">
              <ResponsiveImage image={p} sizes="80px" className="size-full" />
              <button
                type="button"
                className="absolute top-1 right-1 rounded-full bg-surface/90 p-1"
                aria-label="Remove photo"
                onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
          {photos.length < REVIEW_MAX_PHOTOS && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Add a photo"
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploading}
                leftIcon={<ImagePlus className="size-4" aria-hidden="true" />}
                onClick={() => fileRef.current?.click()}
              >
                Add photo
              </Button>
            </>
          )}
        </div>
        {err && !err.firstFieldError('title') && !err.firstFieldError('body') && (
          <Alert tone="danger">{err.message}</Alert>
        )}
      </div>
    </Modal>
  );
}

/** /account/reviews */
export function ReviewsPage() {
  const eligible = useEligibleReviews();
  const mine = useMyReviews();
  const [writing, setWriting] = useState<{ reference: string; hotel: string } | null>(null);
  const [editing, setEditing] = useState<MyReviewDto | null>(null);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Reviews" description="Share verified reviews of your completed stays." />
      <section aria-labelledby="to-review" className="flex flex-col gap-3">
        <h2 id="to-review" className="text-lg font-semibold">
          Stays to review
        </h2>
        {eligible.isPending ? (
          <PageSpinner />
        ) : eligible.error ? (
          <ErrorState description={normalizeApiError(eligible.error).message} />
        ) : eligible.data.length === 0 ? (
          <p className="text-sm text-fg-muted">No completed stays waiting for a review.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eligible.data.map((e) => (
              <li
                key={e.bookingReference}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm"
              >
                <span>
                  <span className="font-medium">{e.hotel.name}</span>{' '}
                  <span className="text-fg-subtle">
                    · checked out {formatStayDate(e.checkOut)} · review by{' '}
                    {formatStayDate(e.reviewableUntil)}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => setWriting({ reference: e.bookingReference, hotel: e.hotel.name })}
                >
                  Write review
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="my-reviews" className="flex flex-col gap-3">
        <h2 id="my-reviews" className="text-lg font-semibold">
          Your reviews
        </h2>
        {mine.isPending ? (
          <PageSpinner />
        ) : mine.error ? (
          <ErrorState description={normalizeApiError(mine.error).message} />
        ) : mine.data.length === 0 ? (
          <EmptyState compact icon={<Star />} title="No reviews yet" />
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.data.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-semibold hover:underline" to={`/hotels/${r.hotel.slug}`}>
                    {r.hotel.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    {r.status !== 'PUBLISHED' && (
                      <Badge tone={r.status === 'REMOVED' ? 'danger' : 'warning'}>
                        {r.status === 'REMOVED' ? 'Removed by moderators' : 'Under review'}
                      </Badge>
                    )}
                    <span className="font-semibold">★ {r.overall.toFixed(1)}</span>
                  </span>
                </div>
                <p className="mt-2 font-medium">{r.title}</p>
                <p className="text-fg-muted">{r.body}</p>
                {r.response && (
                  <p className="mt-2 rounded-lg bg-surface-muted p-3">
                    <span className="font-medium">Property response:</span> {r.response.body}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs text-fg-subtle">
                  <span>
                    {formatInstant(r.createdAt)}
                    {r.editedAt ? ' · edited' : ''}
                  </span>
                  {r.canEdit && (
                    <Button size="sm" variant="link" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {writing && (
        <ReviewEditor
          bookingReference={writing.reference}
          hotelName={writing.hotel}
          onClose={() => setWriting(null)}
        />
      )}
      {editing && (
        <ReviewEditor
          review={editing}
          hotelName={editing.hotel.name}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- wishlists
/** /account/wishlists */
export function WishlistsPage() {
  const query = useQuery({
    queryKey: ['wishlists'],
    queryFn: ({ signal }) => wishlistsApi.list(signal),
  });
  const [name, setName] = useState('');
  const create = useWishlistMutation((n: string) => wishlistsApi.create(n));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName('') });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Wishlists" description="Group saved stays into lists and share them." />
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          label="New list"
          placeholder="e.g. Goa in March"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          containerClassName="sm:max-w-xs"
          error={create.error ? normalizeApiError(create.error).message : undefined}
        />
        <Button
          type="submit"
          leftIcon={<Plus className="size-4" aria-hidden="true" />}
          loading={create.isPending}
        >
          Create list
        </Button>
      </form>
      {query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState
          description={normalizeApiError(query.error).message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {query.data.map((l) => (
            <li key={l.id}>
              <Link
                to={`/account/wishlists/${l.id}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="aspect-[16/9] bg-surface-muted">
                  {l.coverImage ? (
                    <ResponsiveImage image={l.coverImage} sizes="320px" className="size-full" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-fg-subtle">
                      <Heart className="size-8" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between p-4">
                  <span className="font-semibold">{l.name}</span>
                  <span className="flex items-center gap-2 text-sm text-fg-muted">
                    {l.shared && <Badge tone="info">Shared</Badge>}
                    {l.itemCount} stay{l.itemCount === 1 ? '' : 's'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** /account/wishlists/:id — rename, notes, sharing and live availability for chosen dates. */
export function WishlistDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dates, setDates] = useState({ checkIn: '', checkOut: '' });
  const applied: { checkIn?: string; checkOut?: string } =
    dates.checkIn && dates.checkOut && dates.checkOut > dates.checkIn ? dates : {};
  const query = useQuery({
    queryKey: ['wishlist', id, applied],
    queryFn: ({ signal }) => wishlistsApi.detail(id, applied, signal),
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = useWishlistMutation((n: string) => wishlistsApi.rename(id, n));
  const remove = useWishlistMutation(() => wishlistsApi.remove(id));
  const share = useWishlistMutation(() => wishlistsApi.share(id));
  const unshare = useWishlistMutation(() => wishlistsApi.unshare(id));
  const saveNote = useWishlistMutation((v: { hotelId: string; note: string }) =>
    wishlistsApi.saveItem(id, v.hotelId, v.note),
  );
  const removeItem = useWishlistMutation((hotelId: string) => wishlistsApi.removeItem(id, hotelId));
  if (query.isPending) return <PageSpinner />;
  if (query.error)
    return (
      <ErrorState title="List not found" description={normalizeApiError(query.error).message} />
    );
  const list = query.data;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Copy this link', description: url });
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'Wishlists', to: '/account/wishlists' }, { label: list.name }]}
        title={renaming === null ? list.name : 'Rename list'}
        actions={
          <div className="flex flex-wrap gap-2">
            {renaming === null && (
              <Button size="sm" variant="outline" onClick={() => setRenaming(list.name)}>
                Rename
              </Button>
            )}
            {list.shared ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Link2 className="size-4" aria-hidden="true" />}
                  onClick={() => list.shareUrl && void copy(list.shareUrl)}
                >
                  Copy share link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => unshare.mutate(undefined)}>
                  Stop sharing
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Link2 className="size-4" aria-hidden="true" />}
                onClick={() =>
                  share.mutate(undefined, {
                    onSuccess: (r) => void copy((r as { shareUrl: string }).shareUrl),
                  })
                }
              >
                Share
              </Button>
            )}
            {!list.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  remove.mutate(undefined, { onSuccess: () => navigate('/account/wishlists') })
                }
              >
                Delete list
              </Button>
            )}
          </div>
        }
      />
      {renaming !== null && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate(renaming, { onSuccess: () => setRenaming(null) });
          }}
        >
          <Input
            label="List name"
            hideLabel
            value={renaming}
            maxLength={60}
            onChange={(e) => setRenaming(e.target.value)}
          />
          <Button type="submit" loading={rename.isPending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
        </form>
      )}
      {list.shared && (
        <p className="text-sm text-fg-muted">
          Anyone with the link can see the stays in this list — not your notes or account details.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-4">
        <DatePicker
          label="Check-in"
          min={todayIsoDate()}
          value={dates.checkIn}
          onChange={(e) => setDates((d) => ({ ...d, checkIn: e.target.value }))}
        />
        <DatePicker
          label="Check-out"
          min={dates.checkIn || todayIsoDate(1)}
          value={dates.checkOut}
          onChange={(e) => setDates((d) => ({ ...d, checkOut: e.target.value }))}
        />
        <p className="text-sm text-fg-muted">Add dates to see live prices and availability.</p>
      </div>
      {list.unavailableCount > 0 && (
        <Alert tone="info">
          {list.unavailableCount} saved stay{list.unavailableCount === 1 ? ' is' : 's are'} no
          longer listed.
        </Alert>
      )}
      {list.items.length === 0 ? (
        <EmptyState
          icon={<Heart />}
          title="This list is empty"
          action={<ButtonLink to="/hotels">Find stays</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.items.map((item) => (
            <li key={item.hotel.id} className="flex flex-col gap-2">
              <HotelCard
                hotel={item.price ? { ...item.hotel, price: item.price } : item.hotel}
                href={`/hotels/${item.hotel.slug}${applied.checkIn ? `?checkIn=${applied.checkIn}&checkOut=${applied.checkOut}` : ''}`}
              />
              {item.availableForDates === false && (
                <p className="text-sm font-medium text-warning">Not available for these dates</p>
              )}
              <NoteEditor
                initial={item.note}
                onSave={(note) => saveNote.mutate({ hotelId: item.hotel.id, note })}
              />
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => removeItem.mutate(item.hotel.id)}
              >
                Remove from list
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteEditor({ initial, onSave }: { initial: string; onSave: (note: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(note);
      }}
    >
      <Input
        label="Note"
        hideLabel
        placeholder="Add a private note"
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
      />
      {note !== initial && (
        <Button type="submit" size="sm" variant="outline">
          Save
        </Button>
      )}
    </form>
  );
}

/** /wishlists/shared/:token — public, read-only. */
export function SharedWishlistPage() {
  const { token = '' } = useParams();
  const query = useQuery({
    queryKey: ['shared-wishlist', token],
    queryFn: ({ signal }) => wishlistsApi.shared(token, signal),
  });
  if (query.isPending) return <PageSpinner />;
  if (query.error)
    return (
      <div className="container-page py-16">
        <EmptyState
          title="This list isn’t available"
          description="The link may have been turned off by its owner."
          action={<ButtonLink to="/hotels">Explore stays</ButtonLink>}
        />
      </div>
    );
  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <PageHeader eyebrow={`Shared by ${query.data.ownerFirstName}`} title={query.data.name} />
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {query.data.items.map((i) => (
          <li key={i.hotel.id}>
            <HotelCard hotel={i.hotel} href={`/hotels/${i.hotel.slug}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- support
const CATEGORY_LABELS: Record<TicketCategory, string> = {
  BOOKING: 'Booking',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CANCELLATION: 'Cancellation',
  PROPERTY: 'Property',
  ACCOUNT: 'Account',
  OTHER: 'Something else',
};
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_FOR_CUSTOMER: 'Waiting for you',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** /account/support */
export function SupportPage() {
  const query = useQuery({
    queryKey: ['support'],
    queryFn: ({ signal }) => supportApi.list(signal),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Help & support"
        description="Questions about a booking, payment or refund."
        actions={
          <ButtonLink
            to="/account/support/new"
            leftIcon={<Plus className="size-4" aria-hidden="true" />}
          >
            New request
          </ButtonLink>
        }
      />
      {query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState description={normalizeApiError(query.error).message} />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title="No support requests" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {query.data.map((t) => (
            <li key={t.id}>
              <Link
                to={`/account/support/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm hover:bg-surface-muted"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{t.subject}</span>
                  <span className="text-fg-subtle">
                    {t.ticketNumber} · {CATEGORY_LABELS[t.category]}
                    {t.bookingReference ? ` · ${t.bookingReference}` : ''} · updated{' '}
                    {formatInstant(t.lastMessageAt)}
                  </span>
                </span>
                <Badge
                  tone={
                    t.status === 'WAITING_FOR_CUSTOMER'
                      ? 'warning'
                      : ['RESOLVED', 'CLOSED'].includes(t.status)
                        ? 'neutral'
                        : 'info'
                  }
                >
                  {STATUS_LABELS[t.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** /account/support/new?booking= */
export function NewTicketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>(
    params.get('booking') ? 'BOOKING' : 'OTHER',
  );
  const [bookingReference, setBookingReference] = useState(params.get('booking') ?? '');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('subject', subject);
      form.append('category', category);
      if (bookingReference) form.append('bookingReference', bookingReference.trim().toUpperCase());
      form.append('message', message);
      if (file) form.append('file', file);
      return supportApi.create(form);
    },
    onSuccess: (t) => navigate(`/account/support/${t.id}`),
  });
  const err = create.error ? normalizeApiError(create.error) : null;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'Support', to: '/account/support' }, { label: 'New request' }]}
        title="How can we help?"
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input
          label="Subject"
          value={subject}
          maxLength={140}
          onChange={(e) => setSubject(e.target.value)}
          error={err?.firstFieldError('subject') ?? undefined}
          required
        />
        <Select
          label="Topic"
          value={category}
          onChange={(e) => setCategory(e.target.value as TicketCategory)}
          options={TICKET_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
        />
        <Input
          label="Booking reference"
          optionalLabel
          placeholder="SS-XXXXXXXX"
          value={bookingReference}
          onChange={(e) => setBookingReference(e.target.value)}
          error={err?.firstFieldError('bookingReference') ?? undefined}
        />
        <Textarea
          label="Message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          error={err?.firstFieldError('message') ?? undefined}
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <Paperclip className="size-4" aria-hidden="true" />
          <span>Attachment (PDF, JPEG or PNG, up to 5 MB)</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {err &&
          !err.firstFieldError('subject') &&
          !err.firstFieldError('message') &&
          !err.firstFieldError('bookingReference') && <Alert tone="danger">{err.message}</Alert>}
        <Button type="submit" className="self-start" loading={create.isPending}>
          Send
        </Button>
      </form>
    </div>
  );
}

/** /account/support/:id */
export function TicketPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['support', id],
    queryFn: ({ signal }) => supportApi.detail(id, signal),
  });
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const reply = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('body', body);
      if (file) form.append('file', file);
      return supportApi.reply(id, form);
    },
    onSuccess: (t) => {
      qc.setQueryData(['support', id], t);
      setBody('');
      setFile(null);
    },
  });
  const close = useMutation({
    mutationFn: () => supportApi.close(id),
    onSuccess: (t) => qc.setQueryData(['support', id], t),
  });
  if (query.isPending) return <PageSpinner />;
  if (query.error)
    return (
      <ErrorState title="Request not found" description={normalizeApiError(query.error).message} />
    );
  const t = query.data;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'Support', to: '/account/support' }, { label: t.ticketNumber }]}
        title={t.subject}
        description={`${STATUS_LABELS[t.status]}${t.bookingReference ? ` · booking ${t.bookingReference}` : ''}`}
        actions={
          t.status !== 'CLOSED' ? (
            <Button size="sm" variant="ghost" onClick={() => close.mutate()}>
              Close request
            </Button>
          ) : undefined
        }
      />
      <ol className="flex flex-col gap-3">
        {t.messages?.map((m) => (
          <li
            key={m.id}
            className={`rounded-2xl border border-border p-4 text-sm ${m.author === 'CUSTOMER' ? 'bg-surface' : 'bg-primary-soft'}`}
          >
            <p className="flex items-center gap-2 font-medium">
              <MessageSquare className="size-4" aria-hidden="true" />
              {m.authorName}{' '}
              <span className="font-normal text-fg-subtle">· {formatInstant(m.createdAt)}</span>
            </p>
            <p className="mt-2 whitespace-pre-line">{m.body}</p>
            {m.attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-primary underline"
                onClick={() =>
                  void downloadFile(`/support/tickets/${t.id}/attachments/${a.id}`, a.fileName)
                }
              >
                <Paperclip className="size-3.5" aria-hidden="true" />
                {a.fileName}
              </button>
            ))}
          </li>
        ))}
      </ol>
      {t.status !== 'CLOSED' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            reply.mutate();
          }}
        >
          <Textarea
            label="Reply"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={reply.error ? normalizeApiError(reply.error).message : undefined}
          />
          <label className="flex items-center gap-2 text-sm">
            <Paperclip className="size-4" aria-hidden="true" />
            <span>Attachment</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button
            type="submit"
            className="self-start"
            disabled={!body.trim()}
            loading={reply.isPending}
          >
            Send reply
          </Button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
/** /account/settings — preferences (incl. notification choices) and security in one place. */
export function SettingsPage() {
  const { user } = useAuth();
  if (!user) return <PageSpinner />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Notifications, language, currency and security." />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-fg-muted">
          Booking confirmations, payment receipts, cancellations and refunds are always emailed.
          Reminders (check-in, reviews) follow your “booking updates” preference below.
        </CardContent>
      </Card>
      <PreferencesForm user={user} />
      <ChangePasswordCard />
      <SessionsCard />
    </div>
  );
}
