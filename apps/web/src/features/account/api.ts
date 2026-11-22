import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MessageDto,
  NotificationDto,
  Paginated,
  SessionDto,
  UpdatePreferencesInput,
  UpdateProfileInput,
  UserDto,
} from '@stayscape/shared';
import { useAppDispatch } from '@/app/store';
import { userUpdated } from '@/features/auth/auth-slice';
import { http, unwrap } from '@/lib/api/client';

export const accountKeys = {
  profile: ['account', 'profile'] as const,
  sessions: ['account', 'sessions'] as const,
  notifications: (page: number, unreadOnly: boolean) =>
    ['account', 'notifications', page, unreadOnly] as const,
  unread: ['account', 'notifications', 'unread'] as const,
};

export const accountApi = {
  profile: (signal?: AbortSignal) => unwrap<UserDto>(http.get('/users/profile', { signal })),
  updateProfile: (input: UpdateProfileInput) =>
    unwrap<UserDto>(http.patch('/users/profile', input)),
  updatePreferences: (input: UpdatePreferencesInput) =>
    unwrap<UserDto>(http.patch('/users/preferences', input)),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return unwrap<UserDto>(http.post('/users/avatar', form, { timeout: 60_000 }));
  },
  sessions: (signal?: AbortSignal) => unwrap<SessionDto[]>(http.get('/users/sessions', { signal })),
  revokeSession: (id: string) =>
    unwrap<MessageDto>(http.delete(`/users/sessions/${encodeURIComponent(id)}`)),
  notifications: (page: number, unreadOnly: boolean, signal?: AbortSignal) =>
    unwrap<Paginated<NotificationDto>>(
      http.get('/notifications', { params: { page, limit: 10, unreadOnly }, signal }),
    ),
  unreadCount: (signal?: AbortSignal) =>
    unwrap<{ count: number }>(http.get('/notifications/unread-count', { signal })),
  markRead: (id: string) =>
    unwrap<NotificationDto>(http.patch(`/notifications/${encodeURIComponent(id)}/read`)),
  markAllRead: () => unwrap<{ updated: number }>(http.post('/notifications/read-all')),
};

/** Keeps the Redux session identity in sync after any mutation that returns the user. */
function useUserMutation<TInput>(fn: (input: TInput) => Promise<UserDto>) {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (user) => {
      dispatch(userUpdated(user));
      queryClient.setQueryData(accountKeys.profile, user);
    },
  });
}

export const useUpdateProfile = () => useUserMutation(accountApi.updateProfile);
export const useUpdatePreferences = () => useUserMutation(accountApi.updatePreferences);
export const useUploadAvatar = () => useUserMutation(accountApi.uploadAvatar);

export function useSessions() {
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: ({ signal }) => accountApi.sessions(signal),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accountApi.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useNotifications(page: number, unreadOnly: boolean) {
  return useQuery({
    queryKey: accountKeys.notifications(page, unreadOnly),
    queryFn: ({ signal }) => accountApi.notifications(page, unreadOnly, signal),
    placeholderData: (previous) => previous,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: accountKeys.unread,
    queryFn: ({ signal }) => accountApi.unreadCount(signal),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accountApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'notifications'] }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accountApi.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'notifications'] }),
  });
}
