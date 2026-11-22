import { useState } from 'react';
import type { UserDto } from '@stayscape/shared';
import { Alert, Button } from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { errorMessage } from '@/lib/api/errors';

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
      title="Verify your email address"
      action={
        state !== 'sent' && (
          <Button
            size="sm"
            variant="outline"
            loading={state === 'sending'}
            loadingText="Sending…"
            onClick={() => void resend()}
          >
            Resend verification email
          </Button>
        )
      }
    >
      {state === 'sent' || state === 'error'
        ? message
        : `We sent a link to ${user.email}. Verifying protects your account and is required before booking.`}
    </Alert>
  );
}
