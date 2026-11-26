import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calls, on, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { PrivacyCard } from './components/PrivacyCard';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());

beforeEach(() => resetApi());

describe('privacy card', () => {
  it('explains why deletion is blocked and keeps the delete button disabled', async () => {
    on('get', /\/users\/me\/deletion/, () => ({
      blockers: ['You have 1 upcoming or in-progress booking(s).'],
    }));
    renderWithProviders(<PrivacyCard />, { user: makeUser() });
    await userEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    expect(await screen.findByText(/upcoming or in-progress booking/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toBeDisabled();
  });

  it('deletes only after the password and the typed confirmation', async () => {
    on('get', /\/users\/me\/deletion/, () => ({ blockers: [] }));
    on('post', /\/users\/me\/deletion/, () => ({ message: 'deleted' }));
    renderWithProviders(<PrivacyCard />, { user: makeUser() });
    await userEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    const remove = await screen.findByRole('button', { name: 'Delete account' });
    await waitFor(() => expect(screen.getByLabelText('Current password')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Current password'), 'Str0ng-Passw0rd');
    expect(remove).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(remove).toBeEnabled();
    await userEvent.click(remove);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'post')?.body).toEqual({
        password: 'Str0ng-Passw0rd',
        confirm: 'DELETE',
      }),
    );
  });
});
