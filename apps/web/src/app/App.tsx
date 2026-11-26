import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider as ReduxProvider } from 'react-redux';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '@/components/ui';
import { SessionManager } from '@/features/auth/SessionManager';
import { ThemeSync } from '@/features/ui/ThemeToggle';
import { createQueryClient } from '@/lib/query-client';
import { I18nProvider } from '@/lib/i18n';
import { createRouter } from './router';
import { createStore } from './store';
import { AppErrorBoundary } from './AppErrorBoundary';

export function AppProviders({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  const [queryClient] = useState(createQueryClient);
  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ThemeSync />
          <SessionManager>
            <I18nProvider>{children}</I18nProvider>
          </SessionManager>
        </ToastProvider>
      </QueryClientProvider>
    </ReduxProvider>
  );
}

export function App() {
  const [router] = useState(createRouter);
  return (
    <AppErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </AppErrorBoundary>
  );
}
