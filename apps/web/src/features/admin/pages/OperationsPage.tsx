import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RefundDto } from '@stayscape/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  PageHeader,
  PageSpinner,
  useToast,
} from '@/components/ui';
import { operationsApi } from '@/features/bookings/api';
import {
  BookingStatusBadge,
  RefundStatusBadge,
  formatInstant,
  money,
} from '@/features/bookings/components';
import { normalizeApiError } from '@/lib/api/errors';

function RequestDecision({ refund, onDone }: { refund: RefundDto; onDone: () => void }) {
  const [amount, setAmount] = useState(String(refund.amountMinor / 100));
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const decide = useMutation({
    mutationFn: (body: Parameters<typeof operationsApi.decideRefund>[1]) =>
      operationsApi.decideRefund(refund.id, body),
    onSuccess: onDone,
    onError: (e) =>
      toast({
        title: 'Decision failed',
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  // Amounts are entered in major units here and converted to integer minor units exactly once.
  const minor = Math.round(Number(amount) * 100);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        label={`Approve amount (${refund.currency})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        containerClassName="w-40"
      />
      <Button
        size="sm"
        disabled={!Number.isFinite(minor) || minor < 1}
        loading={decide.isPending}
        onClick={() => decide.mutate({ decision: 'APPROVE', amountMinor: minor })}
      >
        Approve
      </Button>
      <Input
        label="Rejection reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        containerClassName="w-56"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={reason.trim().length < 3}
        onClick={() => decide.mutate({ decision: 'REJECT', reason })}
      >
        Reject
      </Button>
    </div>
  );
}

/** /admin/operations — payment exceptions, refunds, failed notifications, flagged reviews. */
export function OperationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ['admin', 'operations'],
    queryFn: ({ signal }) => operationsApi.overview(signal),
    refetchInterval: 30_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'operations'] });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast({ title: 'Done', variant: 'success' });
      refresh();
    },
    onError: (e) =>
      toast({
        title: 'Action failed',
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  if (query.isPending) return <PageSpinner label="Loading operations" />;
  if (query.error)
    return (
      <ErrorState
        description={normalizeApiError(query.error).message}
        onRetry={() => void query.refetch()}
      />
    );
  const o = query.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations"
        description={`Outbox: ${o.outbox.pending} pending · ${o.outbox.failed} failed events`}
      />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Reconciliation required ({o.reconciliation.length})</CardTitle>
          <CardDescription>
            Verified payments that could not be allocated. A full refund starts automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {o.reconciliation.length === 0 && <p className="text-fg-muted">Nothing to reconcile.</p>}
          {o.reconciliation.map((b) => (
            <div
              key={b.reference}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
            >
              <span>
                <strong>{b.reference}</strong> · {b.hotelName} · {b.customerEmail}
                <br />
                <span className="text-fg-muted">{b.note}</span>
              </span>
              <span className="flex items-center gap-2">
                {money(b.totalMinor, b.currency)} <BookingStatusBadge status={b.status} />
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Refunds in progress or failed ({o.refunds.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {o.refunds.length === 0 && <p className="text-fg-muted">No refunds need attention.</p>}
          {o.refunds.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
            >
              <span>
                <strong>{r.bookingReference}</strong> · {r.reason} · {formatInstant(r.requestedAt)}
              </span>
              <span className="flex items-center gap-2">
                {money(r.amountMinor, r.currency)} <RefundStatusBadge status={r.status} />
                {r.status === 'FAILED' && (
                  <Button
                    size="sm"
                    onClick={() => run.mutate(() => operationsApi.retryRefund(r.id))}
                  >
                    Retry
                  </Button>
                )}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Refund requests ({o.pendingRefundRequests.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {o.pendingRefundRequests.length === 0 && (
            <p className="text-fg-muted">No open requests.</p>
          )}
          {o.pendingRefundRequests.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <span>
                <strong>{r.bookingReference}</strong> · {r.hotelName} — “{r.reason}” · up to{' '}
                {money(r.amountMinor, r.currency)} refundable
              </span>
              <RequestDecision refund={r} onDone={refresh} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Failed notifications ({o.failedDeliveries.length})</CardTitle>
          <CardDescription>Deliveries that exhausted their automatic retries.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {o.failedDeliveries.length === 0 && (
            <p className="text-fg-muted">All notifications delivered.</p>
          )}
          {o.failedDeliveries.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
            >
              <span>
                {d.template} → {d.recipient} · {d.attempts} attempt(s) · {d.lastError}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run.mutate(() => operationsApi.retryDelivery(d.id))}
              >
                Retry
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Reported reviews ({o.flaggedReviews.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {o.flaggedReviews.length === 0 && (
            <p className="text-fg-muted">No reports to moderate.</p>
          )}
          {o.flaggedReviews.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{r.hotel.name}</strong> · ★ {r.overall.toFixed(1)} · {r.authorName}{' '}
                <Badge tone="warning">{r.reportCount} report(s)</Badge>
              </span>
              <p className="font-medium">{r.title}</p>
              <p className="text-fg-muted">{r.body}</p>
              <ul className="text-xs text-fg-subtle">
                {r.reports.map((x, i) => (
                  <li key={i}>
                    {x.reason}
                    {x.details ? ` — ${x.details}` : ''}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    run.mutate(() =>
                      operationsApi.moderate(r.id, 'REMOVE', 'Violates the content policy'),
                    )
                  }
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run.mutate(() =>
                      operationsApi.moderate(r.id, 'DISMISS_REPORTS', 'Within policy'),
                    )
                  }
                >
                  Keep (dismiss reports)
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
