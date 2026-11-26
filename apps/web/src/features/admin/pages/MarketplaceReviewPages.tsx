import { AdminAccessibilityPanel } from '@/features/ops/AccessibilityPages';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  BUSINESS_TYPE_LABELS,
  PARTNER_DOCUMENT_LABELS,
  PARTNER_VERIFICATION_STATUSES,
  PROPERTY_TYPE_LABELS,
  PUBLICATION_STATUSES,
  formatMinorUnits,
  type AdminHotelSummaryDto,
  type AdminPartnerSummaryDto,
  type HotelDecision,
  type Paginated,
  type PartnerApplicationDto,
  type PartnerHotelDto,
  type PartnerReviewDecision,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  PageSpinner,
  Pagination,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '@/components/ui';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { STATUS_TONE, statusLabel } from '@/features/partner/pages/PropertyPages';
import { http, unwrap } from '@/lib/api/client';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { tr, trf } from '@/lib/tr';

type AdminPartnerDto = PartnerApplicationDto & {
  owner: { id: string; email: string; name: string };
};
type AdminHotelDto = PartnerHotelDto & {
  partner: { id: string; businessName: string | null; verificationStatus: string };
  roomTypes: Array<{ _id: string; name: string; totalInventory: number; status: string }>;
  ratePlans: Array<{ _id: string; name: string; basePriceMinor: number; currency: 'INR' }>;
};

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function DecisionModal({
  title,
  open,
  needsReason,
  onClose,
  onConfirm,
  loading,
  tone = 'primary',
}: {
  title: string;
  open: boolean;
  needsReason: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
  tone?: 'primary' | 'danger';
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {tr('Cancel')}
          </Button>
          <Button
            variant={tone}
            loading={loading}
            disabled={needsReason && reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {tr('Confirm')}
          </Button>
        </>
      }
    >
      {needsReason ? (
        <Textarea
          label={tr('Reason (shared with the partner)')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          required
        />
      ) : (
        <p className="text-sm text-fg-muted">{tr('This action is recorded in the audit log.')}</p>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- partners */
export function AdminPartnersPage() {
  const [status, setStatus] = useState('UNDER_REVIEW');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admin', 'partners', status, page],
    queryFn: ({ signal }) =>
      unwrap<Paginated<AdminPartnerSummaryDto>>(
        http.get('/admin/partners', {
          params: { status: status || undefined, page, limit: 20 },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const columns: Column<AdminPartnerSummaryDto>[] = [
    {
      id: 'name',
      header: tr('Business'),
      cell: (p) => (
        <Link to={p.id} className="font-medium hover:underline">
          {p.businessName ?? tr('Untitled application')}
        </Link>
      ),
    },
    {
      id: 'owner',
      header: tr('Owner'),
      cell: (p) => (
        <>
          <p>{p.ownerName}</p>
          <p className="text-xs text-fg-subtle">{p.ownerEmail}</p>
        </>
      ),
    },
    { id: 'city', header: tr('City'), cell: (p) => p.city ?? '—' },
    {
      id: 'status',
      header: tr('Status'),
      cell: (p) => (
        <Badge
          tone={
            p.verificationStatus === 'APPROVED'
              ? 'success'
              : p.verificationStatus === 'UNDER_REVIEW'
                ? 'info'
                : p.verificationStatus === 'REJECTED' || p.verificationStatus === 'SUSPENDED'
                  ? 'danger'
                  : 'neutral'
          }
        >
          {statusLabel(p.verificationStatus)}
        </Badge>
      ),
    },
    {
      id: 'submitted',
      header: tr('Submitted'),
      cell: (p) => <span className="text-xs">{date(p.submittedAt)}</span>,
    },
    { id: 'hotels', header: tr('Properties'), align: 'right', cell: (p) => p.hotelCount },
  ];
  const err = query.error ? normalizeApiError(query.error) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Partner approvals')}
        description={tr('Review partner applications and verification documents.')}
        breadcrumb={[{ label: tr('Admin'), to: '/admin' }, { label: tr('Partners') }]}
      />
      <Select
        label={tr('Status')}
        hideLabel
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
        options={[
          { value: '', label: tr('All statuses') },
          ...PARTNER_VERIFICATION_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
        ]}
        containerClassName="max-w-xs"
      />
      <DataTable
        caption={tr('Partner applications')}
        columns={columns}
        rows={query.data?.items}
        getRowId={(p) => p.id}
        loading={query.isPending}
        error={err ? { message: err.message, requestId: err.requestId } : null}
        onRetry={() => void query.refetch()}
        empty={
          <EmptyState
            compact
            title={tr('No applications')}
            description={tr('Nothing matches this filter.')}
          />
        }
      />
      {query.data && (
        <Pagination
          page={page}
          totalPages={query.data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

export function AdminPartnerDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ['admin', 'partner', id],
    queryFn: ({ signal }) => unwrap<AdminPartnerDto>(http.get(`/admin/partners/${id}`, { signal })),
  });
  const [action, setAction] = useState<PartnerReviewDecision['decision'] | null>(null);
  const decide = useMutation({
    mutationFn: (d: PartnerReviewDecision) =>
      unwrap<PartnerApplicationDto>(http.post(`/admin/partners/${id}/decision`, d)),
    onSuccess: () => {
      toast({ title: tr('Decision recorded'), variant: 'success' });
      setAction(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) =>
      toast({
        title: tr('Could not record decision'),
        description: errorMessage(e),
        variant: 'error',
      }),
  });
  if (query.isPending) return <PageSpinner />;
  if (query.isError)
    return (
      <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  const p = query.data;
  const download = async (mediaId: string, name: string) => {
    try {
      const res = await http.get<Blob>(`/admin/partners/${id}/documents/${mediaId}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void name;
    } catch (error) {
      toast({
        title: tr('Could not open document'),
        description: errorMessage(error),
        variant: 'error',
      });
    }
  };
  const s = p.verificationStatus;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={p.business.businessName ?? tr('Partner application')}
        breadcrumb={[
          { label: tr('Admin'), to: '/admin' },
          { label: tr('Partners'), to: '/admin/partners' },
          { label: tr('Application') },
        ]}
        actions={
          <Badge
            className="text-sm"
            tone={s === 'APPROVED' ? 'success' : s === 'UNDER_REVIEW' ? 'info' : 'neutral'}
          >
            {statusLabel(s)}
          </Badge>
        }
      />
      {p.rejectionReason && (
        <Alert tone="warning" title={tr('Last reason recorded')}>
          {p.rejectionReason}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {(s === 'UNDER_REVIEW' || s === 'SUSPENDED') && (
          <Button onClick={() => setAction('APPROVE')}>
            {s === 'SUSPENDED' ? tr('Reinstate') : tr('Approve')}
          </Button>
        )}
        {s === 'UNDER_REVIEW' && (
          <Button variant="outline" onClick={() => setAction('REQUEST_DOCUMENTS')}>
            {tr('Request documents')}
          </Button>
        )}
        {s === 'UNDER_REVIEW' && (
          <Button variant="danger" onClick={() => setAction('REJECT')}>
            {tr('Reject')}
          </Button>
        )}
        {s === 'APPROVED' && (
          <Button variant="danger" onClick={() => setAction('SUSPEND')}>
            {tr('Suspend')}
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Business')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-subtle">{tr('Owner account')}</dt>
                <dd>
                  {p.owner.name}
                  <br />
                  <span className="text-xs">{p.owner.email}</span>
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('Signatory')}</dt>
                <dd>{p.business.ownerName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('Type')}</dt>
                <dd>
                  {p.business.businessType
                    ? tr(BUSINESS_TYPE_LABELS[p.business.businessType])
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('Registration')}</dt>
                <dd>{p.tax.registrationNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('PAN')}</dt>
                <dd>{p.tax.taxDetails?.pan ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('GSTIN')}</dt>
                <dd>{p.tax.taxDetails?.gstin ?? '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-fg-subtle">{tr('Address')}</dt>
                <dd>
                  {[
                    p.contact.businessAddress?.line1,
                    p.contact.businessAddress?.city,
                    p.contact.businessAddress?.state,
                    p.contact.businessAddress?.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('Contact')}</dt>
                <dd>
                  {p.contact.contactDetails?.email}
                  <br />
                  {p.contact.contactDetails?.phone}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{tr('Settlement')}</dt>
                <dd>
                  {p.settlementAccount
                    ? `${p.settlementAccount.bankName} •••• ${p.settlementAccount.accountNumberLast4} (${p.settlementAccount.ifsc})`
                    : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            {p.documents.length === 0 ? (
              <p className="text-sm text-fg-muted">{tr('No documents uploaded.')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {p.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      <span className="font-medium">{tr(PARTNER_DOCUMENT_LABELS[d.type])}</span>
                      <span className="block text-xs text-fg-subtle">
                        {d.fileName} · {(d.size / 1024).toFixed(0)} {tr('KB ·')}{' '}
                        {date(d.uploadedAt)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Download className="size-4" aria-hidden="true" />}
                      onClick={() => void download(d.id, d.fileName)}
                    >
                      {tr('Open')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {p.missingRequirements.length > 0 && (
              <Alert tone="warning" className="mt-4">
                {tr('Missing:')} {p.missingRequirements.join(', ')}
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
      <DecisionModal
        open={action !== null}
        title={
          {
            APPROVE: s === 'SUSPENDED' ? 'Reinstate partner' : 'Approve partner',
            REJECT: 'Reject application',
            REQUEST_DOCUMENTS: 'Request more documents',
            SUSPEND: 'Suspend partner',
          }[action ?? 'APPROVE']
        }
        needsReason={action !== 'APPROVE'}
        tone={action === 'REJECT' || action === 'SUSPEND' ? 'danger' : 'primary'}
        loading={decide.isPending}
        onClose={() => setAction(null)}
        onConfirm={(reason) =>
          action &&
          decide.mutate(
            action === 'APPROVE' ? { decision: 'APPROVE' } : { decision: action, reason },
          )
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- properties */
export function AdminPropertiesPage() {
  const [tab, setTab] = useState('SUBMITTED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params =
    tab === 'REVISIONS' ? { revision: 'SUBMITTED' } : tab === 'ALL' ? {} : { status: tab };
  const query = useQuery({
    queryKey: ['admin', 'hotels', tab, search, page],
    queryFn: ({ signal }) =>
      unwrap<Paginated<AdminHotelSummaryDto>>(
        http.get('/admin/hotels', {
          params: { ...params, search: search || undefined, page, limit: 20 },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const columns: Column<AdminHotelSummaryDto>[] = [
    {
      id: 'name',
      header: tr('Property'),
      cell: (h) => (
        <Link to={h.id} className="font-medium hover:underline">
          {h.name}
        </Link>
      ),
    },
    { id: 'partner', header: tr('Partner'), cell: (h) => h.partnerName ?? '—' },
    { id: 'city', header: tr('City'), cell: (h) => h.city },
    {
      id: 'status',
      header: tr('Status'),
      cell: (h) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[h.publicationStatus]}>{statusLabel(h.publicationStatus)}</Badge>
          {h.revisionStatus === 'SUBMITTED' && (
            <Badge tone="warning">{tr('Changes pending')}</Badge>
          )}
          {h.featured && <Badge tone="accent">{tr('Featured')}</Badge>}
        </div>
      ),
    },
    {
      id: 'submitted',
      header: tr('Submitted'),
      cell: (h) => <span className="text-xs">{date(h.submittedAt)}</span>,
    },
  ];
  const tabs = ['SUBMITTED', 'UNDER_REVIEW', 'REVISIONS', 'PUBLISHED', 'SUSPENDED', 'ALL'];
  const err = query.error ? normalizeApiError(query.error) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Property moderation')}
        description={tr('Approve new listings and changes to live listings.')}
        breadcrumb={[{ label: tr('Admin'), to: '/admin' }, { label: tr('Properties') }]}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={tr('Queue')}
          value={tab}
          onChange={(e) => {
            setTab(e.target.value);
            setPage(1);
          }}
          options={tabs.map((t) => ({
            value: t,
            label: t === 'REVISIONS' ? 'Pending changes' : t === 'ALL' ? 'All' : statusLabel(t),
          }))}
          containerClassName="w-56"
        />
        <Input
          label={tr('Search by name')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          containerClassName="w-72"
        />
      </div>
      <DataTable
        caption={tr('Properties')}
        columns={columns}
        rows={query.data?.items}
        getRowId={(h) => h.id}
        loading={query.isPending}
        error={err ? { message: err.message, requestId: err.requestId } : null}
        onRetry={() => void query.refetch()}
        empty={<EmptyState compact title={tr('Queue is empty')} />}
      />
      {query.data && (
        <Pagination
          page={page}
          totalPages={query.data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
      <p className="text-xs text-fg-subtle">
        {tr('Statuses:')} {PUBLICATION_STATUSES.map(statusLabel).join(' · ')}
      </p>
    </div>
  );
}

function ContentView({ hotel, source }: { hotel: AdminHotelDto; source: 'live' | 'working' }) {
  const c = hotel[source];
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="text-fg-subtle">{tr('Name')}</dt>
        <dd className="font-medium">{c.name}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-fg-subtle">{tr('Description')}</dt>
        <dd className="whitespace-pre-line">{c.description}</dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Type')}</dt>
        <dd>
          {tr(PROPERTY_TYPE_LABELS[c.propertyType])} · {c.starCategory}★
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Location')}</dt>
        <dd>
          {c.address.line1}, {c.city}, {c.state} {c.postalCode} (
          {c.location ? `${c.location.lat}, ${c.location.lng}` : tr('no pin')})
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Contact')}</dt>
        <dd>
          {c.contactDetails.email} · {c.contactDetails.phone}
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Amenities')}</dt>
        <dd>{c.amenities.join(', ') || '—'}</dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Check-in / out')}</dt>
        <dd>
          {c.checkInTime} / {c.checkOutTime}
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle">{tr('Photos')}</dt>
        <dd>{c.images.length}</dd>
      </div>
    </dl>
  );
}

export function AdminPropertyDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ['admin', 'hotel', id],
    queryFn: ({ signal }) => unwrap<AdminHotelDto>(http.get(`/admin/hotels/${id}`, { signal })),
  });
  const [action, setAction] = useState<HotelDecision['decision'] | null>(null);
  const decide = useMutation({
    mutationFn: (d: HotelDecision) => unwrap(http.post(`/admin/hotels/${id}/decision`, d)),
    onSuccess: () => {
      toast({ title: tr('Decision recorded'), variant: 'success' });
      setAction(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) =>
      toast({
        title: tr('Could not record decision'),
        description: errorMessage(e),
        variant: 'error',
      }),
  });
  if (query.isPending) return <PageSpinner />;
  if (query.isError)
    return (
      <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  const h = query.data;
  const s = h.publicationStatus;
  const reasonActions: Array<HotelDecision['decision']> = ['REJECT', 'REJECT_REVISION', 'SUSPEND'];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={h.working.name}
        description={trf('{0} (partner {1})', [
          h.partner.businessName ?? 'Unknown partner',
          statusLabel(h.partner.verificationStatus),
        ])}
        breadcrumb={[
          { label: tr('Admin'), to: '/admin' },
          { label: tr('Properties'), to: '/admin/properties' },
          { label: h.working.name },
        ]}
        actions={
          <Badge className="text-sm" tone={STATUS_TONE[s]}>
            {statusLabel(s)}
          </Badge>
        }
      />
      <AdminAccessibilityPanel hotelId={id} />
      {!h.completeness.ready && (
        <Alert tone="warning" title={tr('Incomplete')}>
          {h.completeness.missing.join(', ')}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {s === 'SUBMITTED' && (
          <Button
            variant="outline"
            onClick={() => decide.mutate({ decision: 'START_REVIEW' })}
            loading={decide.isPending}
          >
            {tr('Start review')}
          </Button>
        )}
        {(s === 'SUBMITTED' || s === 'UNDER_REVIEW') && (
          <>
            <Button onClick={() => setAction('APPROVE')}>{tr('Approve listing')}</Button>
            <Button variant="danger" onClick={() => setAction('REJECT')}>
              {tr('Request changes')}
            </Button>
          </>
        )}
        {h.revision.status === 'SUBMITTED' && (
          <>
            <Button onClick={() => setAction('APPROVE_REVISION')}>{tr('Approve changes')}</Button>
            <Button variant="danger" onClick={() => setAction('REJECT_REVISION')}>
              {tr('Reject changes')}
            </Button>
          </>
        )}
        {(s === 'APPROVED' || s === 'PUBLISHED') && (
          <>
            <Button
              variant="outline"
              onClick={() => decide.mutate({ decision: 'FEATURE', featured: !h.featured })}
              loading={decide.isPending}
            >
              {h.featured ? tr('Remove from featured') : tr('Feature')}
            </Button>
            <Button variant="danger" onClick={() => setAction('SUSPEND')}>
              {tr('Suspend')}
            </Button>
          </>
        )}
        {s === 'SUSPENDED' && (
          <Button onClick={() => setAction('REINSTATE')}>{tr('Reinstate')}</Button>
        )}
      </div>
      {h.images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {h.images.map((img) => (
            <li key={img.id}>
              <ResponsiveImage
                image={img}
                sizes="16rem"
                className="aspect-[4/3] w-full rounded-lg"
              />
            </li>
          ))}
        </ul>
      )}
      <Card>
        <CardContent className="pt-4">
          <Tabs
            label={tr('Listing content')}
            items={[
              ...(h.revision.status === 'SUBMITTED'
                ? [
                    {
                      id: 'proposed',
                      label: trf('Proposed changes ({0})', [h.revision.changedFields.join(', ')]),
                      content: <ContentView hotel={h} source="working" />,
                    },
                  ]
                : []),
              {
                id: 'live',
                label: h.everApproved ? 'Live listing' : 'Submitted listing',
                content: <ContentView hotel={h} source={h.everApproved ? 'live' : 'working'} />,
              },
              {
                id: 'rooms',
                label: tr('Rooms & rates'),
                content: (
                  <div className="grid gap-4 text-sm sm:grid-cols-2">
                    <ul className="flex flex-col gap-1">
                      {h.roomTypes.map((r) => (
                        <li key={r._id}>
                          {r.name} — {r.totalInventory} {tr('rooms (')}
                          {r.status.toLowerCase()})
                        </li>
                      ))}
                    </ul>
                    <ul className="flex flex-col gap-1">
                      {h.ratePlans.map((r) => (
                        <li key={r._id}>
                          {r.name} — {formatMinorUnits(r.basePriceMinor, r.currency ?? 'INR')}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <DecisionModal
        open={action !== null}
        title={
          action
            ? action
                .replace('_', ' ')
                .toLowerCase()
                .replace(/^./, (c) => c.toUpperCase())
            : ''
        }
        needsReason={action ? reasonActions.includes(action) : false}
        tone={action && reasonActions.includes(action) ? 'danger' : 'primary'}
        loading={decide.isPending}
        onClose={() => setAction(null)}
        onConfirm={(reason) => {
          if (!action) return;
          decide.mutate(
            reasonActions.includes(action)
              ? ({ decision: action, reason } as HotelDecision)
              : ({ decision: action } as HotelDecision),
          );
        }}
      />
    </div>
  );
}
