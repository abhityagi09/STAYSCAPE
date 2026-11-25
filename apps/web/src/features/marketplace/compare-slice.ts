import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { MAX_COMPARE_HOTELS } from '@stayscape/shared';

/**
 * Client-side comparison list (works anonymously). Only public listing ids and names are kept —
 * no personal data. Persisted per browser so it survives navigation and reloads.
 */
export interface CompareItem {
  id: string;
  name: string;
}
export const COMPARE_STORAGE_KEY = 'stayscape.compare';

function load(): CompareItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMPARE_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (i): i is CompareItem =>
              typeof i?.id === 'string' &&
              /^[a-f\d]{24}$/i.test(i.id) &&
              typeof i?.name === 'string',
          )
          .slice(0, MAX_COMPARE_HOTELS)
      : [];
  } catch {
    return [];
  }
}

export const compareSlice = createSlice({
  name: 'compare',
  initialState: () => ({ items: load() }),
  reducers: {
    toggleCompare(state, action: PayloadAction<CompareItem>) {
      const exists = state.items.some((i) => i.id === action.payload.id);
      if (exists) state.items = state.items.filter((i) => i.id !== action.payload.id);
      else if (state.items.length < MAX_COMPARE_HOTELS) state.items.push(action.payload);
    },
    removeCompare(state, action: PayloadAction<string>) {
      state.items = state.items.filter((i) => i.id !== action.payload);
    },
    clearCompare(state) {
      state.items = [];
    },
  },
});

export const { toggleCompare, removeCompare, clearCompare } = compareSlice.actions;

export function persistCompare(items: CompareItem[]) {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
}
