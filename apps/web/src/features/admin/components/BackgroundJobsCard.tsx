import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SkeletonText,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { http, unwrap } from '@/lib/api/client';
import { normalizeApiError } from '@/lib/api/errors';
import { tr, trf } from '@/lib/tr';

interface FailedJob {
  queue: string;
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string;
  failedAt: string | null;
}
interface QueueOverview {
  queue: string;
  counts: Record<string, number>;
  failed: FailedJob[];
}

const QUEUE_LABELS: Record<string, string> = {
  get 'stayscape-email'() {
    return tr('Email');
  },
  get 'stayscape-domain-events'() {
    return tr('Domain events');
  },
  get 'stayscape-maintenance'() {
    return tr('Scheduled maintenance');
  },
};

/** Queue depth and dead-lettered jobs (failed after all retries), with an audited retry. */
export function BackgroundJobsCard() {
  const { can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ['admin', 'operations', 'jobs'],
    queryFn: () => unwrap<QueueOverview[]>(http.get('/admin/operations/jobs')),
    refetchInterval: 30_000,
    retry: false,
  });
  const retry = useMutation({
    mutationFn: (job: FailedJob) =>
      http.post(
        `/admin/operations/jobs/${encodeURIComponent(job.queue)}/${encodeURIComponent(job.id)}/retry`,
      ),
    onSuccess: async () => {
      toast({ title: tr('Job queued for another attempt'), variant: 'success' });
      await qc.invalidateQueries({ queryKey: ['admin', 'operations', 'jobs'] });
    },
    onError: (e) =>
      toast({
        title: tr('Could not retry the job'),
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  const error = jobs.isError ? normalizeApiError(jobs.error) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{tr('Background jobs')}</CardTitle>
        <CardDescription>
          {tr(
            'Jobs retry five times with exponential back-off; ones that still fail are kept for 7 days. Every job is idempotent, so a retry never duplicates an email, refund or ledger entry.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {jobs.isPending && <SkeletonText lines={3} />}
        {error && (
          <Alert tone={error.status === 503 ? 'info' : 'danger'}>
            {error.status === 503
              ? tr('Job queues are not configured in this environment.')
              : error.message}
          </Alert>
        )}
        {jobs.data?.map((q) => (
          <div key={q.queue} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{QUEUE_LABELS[q.queue] ?? q.queue}</strong>
              {(['waiting', 'active', 'delayed', 'failed'] as const).map((state) => (
                <Badge
                  key={state}
                  tone={state === 'failed' && (q.counts.failed ?? 0) > 0 ? 'danger' : 'neutral'}
                >
                  {trf('{0}: {1}', [state, q.counts[state] ?? 0])}
                </Badge>
              ))}
            </div>
            {q.failed.length === 0 ? (
              <p className="text-fg-muted">{tr('No failed jobs.')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {q.failed.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {job.name}{' '}
                        <span className="text-fg-subtle">
                          {trf('· {0} attempts', [job.attemptsMade])}
                        </span>
                      </span>
                      <span className="break-words text-fg-muted">{job.failedReason}</span>
                    </span>
                    {can('system:configure') && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={retry.isPending && retry.variables?.id === job.id}
                        onClick={() => retry.mutate(job)}
                      >
                        {tr('Retry')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
