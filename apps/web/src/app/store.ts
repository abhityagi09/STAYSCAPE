import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { authSlice } from '@/features/auth/auth-slice';
import { uiSlice } from '@/features/ui/ui-slice';
import { compareSlice, persistCompare } from '@/features/marketplace/compare-slice';

/**
 * Global *client* state only (session identity, UI preferences). Server data lives in
 * TanStack Query. The access token is deliberately not stored here.
 */
export function createStore() {
  const store = configureStore({
    reducer: { auth: authSlice.reducer, ui: uiSlice.reducer, compare: compareSlice.reducer },
  });
  let last = store.getState().compare.items;
  store.subscribe(() => {
    const items = store.getState().compare.items;
    if (items !== last) {
      last = items;
      persistCompare(items);
    }
  });
  return store;
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
