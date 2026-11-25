import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink, Drawer, IconButton } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { ThemeToggle } from '@/features/ui/ThemeToggle';
import { cn } from '@/lib/cn';
import { UserMenu } from './UserMenu';

export const PUBLIC_NAV = [
  { to: '/hotels', label: 'Find a stay' },
  { to: '/#destinations', label: 'Destinations' },
  { to: '/#inspiration', label: 'Inspiration' },
  { to: '/partners', label: 'List your property' },
];

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const { isAuthenticated, status } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);
  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  const inverse = overlay && !scrolled;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300',
        inverse
          ? 'border-b border-transparent bg-transparent'
          : 'border-b border-border bg-bg/85 shadow-xs backdrop-blur-md',
        overlay && '-mb-[73px]',
      )}
    >
      <div className="container-page flex h-[72px] items-center justify-between gap-6">
        <Logo tone={inverse ? 'inverse' : 'default'} />
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {PUBLIC_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                inverse
                  ? 'text-ivory/85 hover:bg-white/10 hover:text-ivory'
                  : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
              )}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle variant={inverse ? 'inverse' : 'ghost'} />
          {status !== 'initializing' &&
            (isAuthenticated ? (
              <UserMenu />
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <ButtonLink
                  to="/login"
                  variant="ghost"
                  size="sm"
                  className={cn(inverse && 'text-ivory hover:bg-white/10')}
                >
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register" variant={inverse ? 'accent' : 'primary'} size="sm">
                  Create account
                </ButtonLink>
              </div>
            ))}
          <IconButton
            label="Open menu"
            icon={<Menu />}
            className="lg:hidden"
            variant={inverse ? 'inverse' : 'ghost'}
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
          />
        </div>
      </div>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-lg px-3 py-3 text-base font-medium text-fg hover:bg-surface-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {!isAuthenticated && (
          <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
            <ButtonLink to="/login" variant="outline" fullWidth>
              Sign in
            </ButtonLink>
            <ButtonLink to="/register" fullWidth>
              Create account
            </ButtonLink>
          </div>
        )}
      </Drawer>
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const columns = [
    {
      title: 'Explore',
      links: [
        { to: '/search', label: 'Find a stay' },
        { to: '/#destinations', label: 'Destinations' },
        { to: '/#inspiration', label: 'Travel notes' },
      ],
    },
    {
      title: 'Partners',
      links: [
        { to: '/partners', label: 'List your property' },
        { to: '/partner/onboarding', label: 'Partner onboarding' },
      ],
    },
    {
      title: 'Account',
      links: [
        { to: '/login', label: 'Sign in' },
        { to: '/register', label: 'Create account' },
        { to: '/account', label: 'My account' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { to: '/terms', label: 'Terms of service' },
        { to: '/privacy', label: 'Privacy policy' },
      ],
    },
  ];
  return (
    <footer className="mt-24 bg-forest-950 text-ivory/80">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="flex flex-col gap-4">
          <Logo tone="inverse" />
          <p className="max-w-xs text-sm text-ivory/65">
            Verified hotels, resorts and boutique stays — booked with clear prices and real
            availability.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="mb-4 text-xs font-semibold tracking-[0.18em] text-gold-400 uppercase">
              {column.title}
            </h2>
            <ul className="flex flex-col gap-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="hover:text-ivory hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-ivory/50 sm:flex-row sm:justify-between">
          <p>© {year} STAYSCAPE. All rights reserved.</p>
          <p>Prices shown in your preferred currency. Taxes and fees disclosed before payment.</p>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader overlay={isHome} />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
