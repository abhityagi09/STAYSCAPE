import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeUser, renderWithProviders } from '@/test/render';
import { SiteHeader } from './PublicLayout';
import { AdminLayout, CustomerLayout } from './workspaces';

describe('responsive navigation', () => {
  it('opens the mobile menu drawer and closes it with Escape, restoring focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SiteHeader />, { user: null });
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    await user.click(toggle);

    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    const mobileNav = within(dialog).getByRole('navigation', { name: 'Mobile' });
    expect(within(mobileNav).getByRole('link', { name: 'Find a stay' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Create account' })).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('keeps Tab focus trapped inside the open drawer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SiteHeader />, { user: null });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('shows the account menu instead of sign-in links for signed-in users', async () => {
    renderWithProviders(<SiteHeader />, { user: makeUser() });
    expect(screen.getByRole('button', { name: /account menu for asha rao/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('renders role-aware admin navigation', async () => {
    const routes = [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [{ index: true, element: <p>content</p> }],
      },
    ];
    renderWithProviders(routes, { route: '/admin', user: makeUser({ roles: ['SUPPORT'] }) });
    const nav = await screen.findAllByRole('navigation', { name: 'Workspace' });
    const sidebar = nav[0]!;
    expect(within(sidebar).getByRole('link', { name: /Users & roles/ })).toBeInTheDocument();
    // SUPPORT lacks audit:read, so the audit log link is hidden.
    expect(within(sidebar).queryByRole('link', { name: /Audit log/ })).not.toBeInTheDocument();
  });

  it('labels unavailable customer modules honestly instead of linking to them', async () => {
    const routes = [
      {
        path: '/account',
        element: <CustomerLayout />,
        children: [{ index: true, element: <p>content</p> }],
      },
    ];
    renderWithProviders(routes, { route: '/account', user: makeUser() });
    const sidebar = (await screen.findAllByRole('navigation', { name: 'Workspace' }))[0]!;
    expect(within(sidebar).queryByRole('link', { name: /Trips/ })).not.toBeInTheDocument();
    expect(within(sidebar).getByText('Trips').closest('[aria-disabled="true"]')).not.toBeNull();
  });
});
