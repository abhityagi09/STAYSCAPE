import { useId, useState, type ReactNode } from 'react';
import { addDays, formatMinorUnits, todayInTimeZone, type CurrencyCode } from '@stayscape/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorState,
  Input,
  Skeleton,
  type BadgeTone,
} from '@/components/ui';
import { normalizeApiError } from '@/lib/api/errors';

export const fmtMoney = (
  minor: number | null | undefined,
  currency: CurrencyCode | string = 'INR',
) =>
  minor === null || minor === undefined ? '—' : formatMinorUnits(minor, currency as CurrencyCode);
export const fmtPct = (bp: number | null | undefined) =>
  bp === null || bp === undefined ? '—' : `${(bp / 100).toFixed(1)}%`;
export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** KPI tile with an optional change versus the previous period. */
export function KpiTile({
  label,
  value,
  hint,
  changeBp,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  changeBp?: number | null | undefined;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{label}</span>
        <span className="font-display text-2xl text-fg tabular-nums">{value}</span>
        {changeBp !== undefined && changeBp !== null && (
          <span className={changeBp >= 0 ? 'text-xs text-success' : 'text-xs text-danger'}>
            {changeBp >= 0 ? '▲' : '▼'} {Math.abs(changeBp / 100).toFixed(1)}% vs previous period
          </span>
        )}
        {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      </CardContent>
    </Card>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

/**
 * Accessible bar chart (inline SVG, no chart library): the bars are decorative for screen readers,
 * which get the same numbers as a table.
 */
export function BarChart({
  title,
  data,
  format = (v) => String(v),
  height = 160,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  format?: (v: number) => string;
  height?: number;
}) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="flex flex-col gap-2" aria-labelledby={id}>
      <figcaption id={id} className="flex items-center justify-between text-sm font-medium text-fg">
        {title}
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
        >
          {showTable ? 'Show chart' : 'Show as table'}
        </Button>
      </figcaption>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">No data for this period.</p>
      ) : showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th scope="col" className="py-1">
                Period
              </th>
              <th scope="col" className="py-1 text-right">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-border">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          role="img"
          aria-label={`${title}: ${data.length} values, highest ${format(max)}`}
          viewBox={`0 0 ${data.length * 12} ${height}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
        >
          {data.map((d, i) => {
            const h = Math.max(1, (d.value / max) * (height - 4));
            return (
              <rect
                key={d.label}
                x={i * 12 + 2}
                y={height - h}
                width={8}
                height={h}
                rx={2}
                className="fill-primary"
              >
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
            );
          })}
        </svg>
      )}
    </figure>
  );
}

/** Date-range filter (property-local dates, end exclusive in the API). */
export function PeriodFilter({
  value,
  onChange,
  children,
}: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
  children?: ReactNode;
}) {
  const today = todayInTimeZone('Asia/Kolkata');
  const presets = [
    { label: 'Next 30 days', from: today, to: addDays(today, 30) },
    { label: 'Last 30 days', from: addDays(today, -30), to: today },
    { label: 'Last 90 days', from: addDays(today, -90), to: today },
  ];
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Reporting period">
      <Input
        type="date"
        label="From"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        containerClassName="w-44"
      />
      <Input
        type="date"
        label="To"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        containerClassName="w-44"
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant={value.from === p.from && value.to === p.to ? 'secondary' : 'ghost'}
            onClick={() => onChange({ from: p.from, to: p.to })}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function QueryState({
  query,
  children,
  skeleton = 3,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
  skeleton?: number;
}) {
  if (query.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: skeleton }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  if (query.isError) {
    const e = normalizeApiError(query.error);
    return (
      <ErrorState
        description={e.message}
        requestId={e.requestId}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children}</>;
}

const TONES: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  LIVE: 'success',
  PROCESSED: 'success',
  PAID: 'success',
  REWARDED: 'success',
  APPROVED: 'success',
  AUTO_APPROVED: 'success',
  BOOKED: 'success',
  OK: 'success',
  RESOLVED: 'success',
  ACCEPTED: 'success',
  SUCCEEDED: 'success',
  PENDING: 'warning',
  SCHEDULED: 'info',
  DRAFT: 'neutral',
  OPEN: 'info',
  IN_PROGRESS: 'info',
  WAITING_FOR_CUSTOMER: 'neutral',
  ELIGIBLE: 'info',
  PROCESSING: 'info',
  PENDING_VERIFICATION: 'warning',
  PAUSED: 'neutral',
  NEVER: 'neutral',
  FAILED: 'danger',
  CONFLICT: 'danger',
  ERROR: 'danger',
  REJECTED: 'danger',
  ESCALATED: 'danger',
  SUSPENDED: 'danger',
  ON_HOLD: 'warning',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
  CLOSED: 'neutral',
  REVOKED: 'neutral',
  URGENT: 'danger',
  HIGH: 'warning',
  NORMAL: 'neutral',
  LOW: 'neutral',
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={TONES[status] ?? 'neutral'}>
      {status
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="text-sm text-fg-muted">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
