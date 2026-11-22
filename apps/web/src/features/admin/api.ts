import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountStatus,
  AdminUserDto,
  AuditLogDto,
  ListAuditQuery,
  ListUsersQuery,
  Paginated,
  Role,
  RoleDefinitionDto,
} from '@stayscape/shared';
import { http, unwrap } from '@/lib/api/client';

type UsersFilter = Partial<ListUsersQuery> & { page: number };
type AuditFilter = Partial<ListAuditQuery> & { page: number };

const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));

export const adminApi = {
  users: (filter: UsersFilter, signal?: AbortSignal) =>
    unwrap<Paginated<AdminUserDto>>(
      http.get('/users', { params: clean({ limit: 20, ...filter }), signal }),
    ),
  roles: (signal?: AbortSignal) => unwrap<RoleDefinitionDto[]>(http.get('/roles', { signal })),
  updateRoles: ({ id, roles }: { id: string; roles: Role[] }) =>
    unwrap<AdminUserDto>(http.patch(`/users/${id}/roles`, { roles })),
  updateStatus: ({ id, status, reason }: { id: string; status: AccountStatus; reason?: string }) =>
    unwrap<AdminUserDto>(
      http.patch(`/users/${id}/status`, { status, ...(reason ? { reason } : {}) }),
    ),
  audit: (filter: AuditFilter, signal?: AbortSignal) =>
    unwrap<Paginated<AuditLogDto>>(
      http.get('/audit', { params: clean({ limit: 20, ...filter }), signal }),
    ),
};

export function useAdminUsers(filter: UsersFilter) {
  return useQuery({
    queryKey: ['admin', 'users', filter],
    queryFn: ({ signal }) => adminApi.users(filter, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAuditLog(filter: AuditFilter, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: ({ signal }) => adminApi.audit(filter, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRoleDefinitions() {
  return useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: ({ signal }) => adminApi.roles(signal),
    staleTime: Infinity,
  });
}

export function useUpdateUserRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.updateRoles,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.updateStatus,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}
