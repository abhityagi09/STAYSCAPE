import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  PasswordInput,
  useToast,
} from '@/components/ui';
import { useAppDispatch } from '@/app/store';
import { signedOut } from '@/features/auth/auth-slice';
import { http, unwrap } from '@/lib/api/client';
import { normalizeApiError } from '@/lib/api/errors';
import { tokenStore } from '@/lib/api/token-store';
import { tr } from '@/lib/tr';

/** Data-subject rights: download a copy of your data, or delete the account. */
export function PrivacyCard() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const data = await unwrap<unknown>(http.get('/users/me/export'));
      const href = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = href;
      a.download = `stayscape-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast({
        title: tr('Could not prepare your data'),
        description: normalizeApiError(error).message,
        variant: 'error',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('Your data')}</CardTitle>
        <CardDescription>
          {tr(
            'Download a copy of the personal data we hold about you, or delete your account. Booking, payment and invoice records are kept for as long as tax law requires.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => void download()} loading={downloading}>
          <Download className="size-4" aria-hidden="true" />
          {tr('Download my data')}
        </Button>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          {tr('Delete account…')}
        </Button>
      </CardContent>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const blockers = useQuery({
    queryKey: ['privacy', 'deletion'],
    queryFn: () => unwrap<{ blockers: string[] }>(http.get('/users/me/deletion')),
    staleTime: 0,
  });
  const blocked = (blockers.data?.blockers.length ?? 0) > 0;

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await http.post('/users/me/deletion', { password, confirm });
      tokenStore.clear();
      queryClient.clear();
      dispatch(signedOut());
      void navigate('/', { replace: true, state: { notice: 'account-deleted' } });
    } catch (e) {
      const apiError = normalizeApiError(e);
      setError(apiError.message);
      setDetails(apiError.details?.formErrors ?? []);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tr('Delete your account?')}
      description={tr(
        'Your profile, saved lists, alerts and notifications are removed and you are signed out everywhere. This cannot be undone.',
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr('Cancel')}
          </Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={blocked || blockers.isPending || !password || confirm !== 'DELETE'}
            onClick={() => void submit()}
          >
            {tr('Delete account')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {blockers.isError && (
          <Alert tone="danger">{normalizeApiError(blockers.error).message}</Alert>
        )}
        {blocked && (
          <Alert tone="warning" title={tr('Your account cannot be deleted yet')}>
            <ul className="list-disc pl-5">
              {blockers.data?.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}
        {error && (
          <Alert tone="danger" title={error}>
            {details.length > 0 && (
              <ul className="list-disc pl-5">
                {details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <PasswordInput
          label={tr('Current password')}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={blocked}
        />
        <Input
          label={tr('Type DELETE to confirm')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          disabled={blocked}
        />
      </div>
    </Modal>
  );
}
