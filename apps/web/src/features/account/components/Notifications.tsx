import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationDto } from '@stayscape/shared';
import { Badge, Button, EmptyState, ErrorState, SkeletonText } from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useMarkNotificationRead } from '../api';

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

export function NotificationList({
  items,
  isPending,
  error,
  onRetry,
  compact,
}: {
  items: NotificationDto[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
}) {
  const markRead = useMarkNotificationRead();
  if (isPending) return <SkeletonText lines={4} />;
  if (error) return <ErrorState description={errorMessage(error)} onRetry={onRetry} />;
  if (!items || items.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Bell />}
        title="You're all caught up"
        description="Account and booking updates will appear here."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className={cn('flex items-start gap-3 py-4', compact && 'py-3')}>
          <span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              item.readAt ? 'bg-transparent' : 'bg-accent',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {item.title}
              {!item.readAt && <Badge tone="accent">New</Badge>}
            </p>
            <p className="mt-0.5 text-sm text-fg-muted">{item.body}</p>
            <p className="mt-1 text-xs text-fg-subtle">
              <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
            </p>
          </div>
          {!item.readAt && !compact && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<CheckCheck className="size-4" aria-hidden="true" />}
              loading={markRead.isPending && markRead.variables === item.id}
              onClick={() => markRead.mutate(item.id)}
              aria-label={`Mark "${item.title}" as read`}
            >
              Mark read
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
