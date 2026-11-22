import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserDto } from '@stayscape/shared';

export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  /** Set when an existing session ended unexpectedly (expired/revoked), to explain the redirect. */
  sessionExpired: boolean;
}

const initialState: AuthState = { status: 'initializing', user: null, sessionExpired: false };

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<UserDto>) {
      state.status = 'authenticated';
      state.user = action.payload;
      state.sessionExpired = false;
    },
    userUpdated(state, action: PayloadAction<UserDto>) {
      if (state.user && state.user.id === action.payload.id) state.user = action.payload;
    },
    signedOut(state) {
      state.status = 'unauthenticated';
      state.user = null;
      state.sessionExpired = false;
    },
    sessionExpired(state) {
      const hadSession = state.status === 'authenticated';
      state.status = 'unauthenticated';
      state.user = null;
      state.sessionExpired = hadSession;
    },
    expiryNoticeShown(state) {
      state.sessionExpired = false;
    },
  },
});

export const { signedIn, userUpdated, signedOut, sessionExpired, expiryNoticeShown } =
  authSlice.actions;
