import { useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { Dropdown, IconButton } from '@/components/ui';
import { THEME_STORAGE_KEY, themeChanged, type ThemePreference } from './ui-slice';

/** Applies the theme preference to <html> and persists it (a per-device UI preference). */
export function ThemeSync() {
  const theme = useAppSelector((state) => state.ui.theme);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (theme !== 'system' || !media) return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return null;
}

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle({ variant = 'ghost' }: { variant?: 'ghost' | 'inverse' }) {
  const theme = useAppSelector((state) => state.ui.theme);
  const dispatch = useAppDispatch();
  const Current = options.find((o) => o.value === theme)?.icon ?? Monitor;
  return (
    <Dropdown
      trigger={(props) => (
        <IconButton {...props} label={`Theme: ${theme}`} icon={<Current />} variant={variant} />
      )}
      items={options.map((option) => ({
        id: option.value,
        label: `${option.label}${option.value === theme ? ' ✓' : ''}`,
        icon: <option.icon />,
        onSelect: () => dispatch(themeChanged(option.value)),
      }))}
    />
  );
}
