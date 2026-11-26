import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { http, unwrap } from '@/lib/api/client';

/** Thin typed helpers for the Phase 4 endpoints (operations, administration, intelligent features). */
type Params = Record<string, string | number | boolean | undefined | null>;
const clean = (p?: Params) => (p ? Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined);

export const api = {
  get: <T>(url: string, params?: Params) => unwrap<T>(http.get(url, { params: clean(params) })),
  post: <T>(url: string, body?: unknown) => unwrap<T>(http.post(url, body ?? {})),
  put: <T>(url: string, body?: unknown) => unwrap<T>(http.put(url, body ?? {})),
  patch: <T>(url: string, body?: unknown) => unwrap<T>(http.patch(url, body ?? {})),
  del: <T>(url: string) => unwrap<T>(http.delete(url)),
};

export function useApiQuery<T>(key: QueryKey, url: string | null, params?: Params, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...key, url, params],
    queryFn: () => api.get<T>(url!, params),
    enabled: url !== null && (options.enabled ?? true),
  });
}

/** Mutation that refreshes the given query prefixes on success. */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

export interface Page<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** CSV export: the API streams text/csv; download it through the authenticated client. */
export async function downloadCsv(url: string, params: Params, fileName: string) {
  const res = await http.get(url, { params: { ...clean(params), format: 'csv' }, responseType: 'blob' });
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(href);
}

/** Download a protected file (the access token is held in memory, so a plain link would not be authorised). */
export async function downloadFile(url: string, fileName: string) {
  const res = await http.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(href);
}
