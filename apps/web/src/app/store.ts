import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { authSlice } from '@/features/auth/auth-slice';
import { uiSlice } from '@/features/ui/ui-slice';

/**
 * Global *client* state only (session identity, UI preferences). Server data lives in
 * TanStack Query. The access token is deliberately not stored here.
 */
export function createStore() {
  return configureStore({
    reducer: { auth: authSlice.reducer, ui: uiSlice.reducer },
  });
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
