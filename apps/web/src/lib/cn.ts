import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge about the custom display font sizes so `text-display-lg` is not
// mistaken for a text colour (and vice versa for semantic colours like `text-fg`).
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ['display-sm', 'display-md', 'display-lg', 'display-xl'] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
