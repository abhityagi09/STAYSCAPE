import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api/errors';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Never retry client errors (4xx); retry transient failures twice.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
