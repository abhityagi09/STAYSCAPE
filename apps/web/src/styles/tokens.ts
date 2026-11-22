/**
 * Design tokens for JavaScript consumers (charts, canvas, inline SVG).
 * CSS components should use the Tailwind semantic classes instead (bg-surface, text-fg...).
 * Keep in sync with src/styles/index.css.
 */
export const brand = {
  forest: '#173D35',
  ivory: '#F8F6F1',
  sand: '#E8DFD1',
  charcoal: '#222725',
  gold: '#C6A66B',
  white: '#FFFFFF',
} as const;

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export const breakpoints = { xs: 480, sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;
