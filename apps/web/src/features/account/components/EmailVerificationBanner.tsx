import { useState } from 'react';
import type { UserDto } from '@stayscape/shared';
import { Alert, Button } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { errorMessage } from '@/lib/api/errors';
import { tr, trf } from '@/lib/tr';

export function EmailVerificationBanner({ user }: { user: UserDto }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  if (user.emailVerified) return null;

  const resend = async () => {
    setState('sending');
    try {
      const result = await authApi.resendVerification(user.email);
      setMessage(result.message);
      setState('sent');
    } catch (error) {
      setMessage(errorMessage(error));
      setState('error');
    }
  };

  return (
    <Alert
      tone={state === 'error' ? 'danger' : 'warning'}
      title={tr('Verify your email address')}
      action={
        state !== 'sent' && (
          <Button
            size="sm"
            variant="outline"
            loading={state === 'sending'}
            loadingText="Sending…"
            onClick={() => void resend()}
          >
            {tr('Resend verification email')}
          </Button>
        )
      }
    >
      {state === 'sent' || state === 'error'
        ? message
        : trf(
            'We sent a link to {0}. Verifying protects your account and is required before booking.',
            [user.email],
          )}
    </Alert>
  );
}
