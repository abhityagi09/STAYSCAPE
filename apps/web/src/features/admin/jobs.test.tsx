import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calls, on, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { BackgroundJobsCard } from './components/BackgroundJobsCard';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());
beforeEach(() => resetApi());

const overview = [
  {
    queue: 'stayscape-email',
    counts: { waiting: 0, active: 0, delayed: 0, failed: 1 },
    failed: [
      {
        queue: 'stayscape-email',
        id: '42',
        name: 'send',
        attemptsMade: 5,
        failedReason: 'SMTP unavailable',
        failedAt: null,
      },
    ],
  },
];

describe('background jobs card', () => {
  it('lists dead-lettered jobs and lets a super administrator retry one', async () => {
    on('get', /\/admin\/operations\/jobs/, () => overview);
    on('post', /\/admin\/operations\/jobs\/stayscape-email\/42\/retry/, () => ({ retried: true }));
    renderWithProviders(<BackgroundJobsCard />, { user: makeUser({ roles: ['SUPER_ADMIN'] }) });
    expect(await screen.findByText('SMTP unavailable')).toBeInTheDocument();
    expect(screen.getByText('failed: 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'post' && c.url.endsWith('/42/retry'))).toBe(true),
    );
  });

  it('hides retry without system:configure and explains when queues are not configured', async () => {
    on('get', /\/admin\/operations\/jobs/, () => overview);
    const { unmount } = renderWithProviders(<BackgroundJobsCard />, {
      user: makeUser({ roles: ['ADMIN'] }),
    });
    expect(await screen.findByText('SMTP unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    unmount();
    resetApi();
    on('get', /\/admin\/operations\/jobs/, () =>
      Object.assign(new Error('unavailable'), {
        isAxiosError: true,
        response: {
          status: 503,
          data: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } },
        },
      }),
    );
    renderWithProviders(<BackgroundJobsCard />, { user: makeUser({ roles: ['ADMIN'] }) });
    expect(
      await screen.findByText('Job queues are not configured in this environment.'),
    ).toBeInTheDocument();
  });
});
