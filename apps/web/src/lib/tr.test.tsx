import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import LoginPage from '@/features/auth/pages/LoginPage';
import { renderWithProviders } from '@/test/render';
import { activateLanguage, currentLanguage, tr, trf } from './tr';

afterEach(async () => {
  await activateLanguage('en');
});

describe('source-text translation', () => {
  it('returns English unchanged until another language is activated', () => {
    expect(currentLanguage()).toBe('en');
    expect(tr('Sign in')).toBe('Sign in');
    expect(trf('{0} pending', [3])).toBe('3 pending');
  });

  it('translates keys and fills placeholders in Hindi', async () => {
    await activateLanguage('hi');
    expect(tr('Sign in')).toBe('साइन इन करें');
    expect(trf('{0} pending', [3])).toBe('3 लंबित');
    // Unknown strings fall back to the English source rather than disappearing.
    expect(tr('Not a translated string')).toBe('Not a translated string');
  });

  it('renders a Phase 1 screen (sign-in) in Hindi', async () => {
    await activateLanguage('hi');
    renderWithProviders(<LoginPage />, { user: null, route: '/login' });
    expect(await screen.findByRole('heading', { name: 'फिर से स्वागत है' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^ईमेल/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^पासवर्ड/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'साइन इन करें' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });
});
