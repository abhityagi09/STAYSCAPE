import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import type { Permission } from '@stayscape/shared';
import { Logo } from '@/components/brand/Logo';
import { Badge, Drawer, IconButton } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { ThemeToggle } from '@/features/ui/ThemeToggle';
import { LanguageSwitcher, useI18n, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { UserMenu } from './UserMenu';
import { tr } from '@/lib/tr';

export interface NavItem {
  to: string;
  label: string;
  /** Translation key; falls back to `label`. */
  labelKey?: MessageKey;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  /** Hidden unless the user holds every listed permission. */
  permissions?: Permission[];
  /** Module not yet available: rendered disabled with an honest label. */
  upcoming?: string;
}

export interface NavSection {
  title?: string;
  titleKey?: MessageKey;
  items: NavItem[];
}

function SideNav({ sections }: { sections: NavSection[] }) {
  const { can } = useAuth();
  const { t } = useI18n();
  return (
    <nav aria-label={tr('Workspace')} className="flex flex-col gap-6">
      {sections.map((section, index) => {
        const items = section.items.filter((item) => !item.permissions || can(...item.permissions));
        if (items.length === 0) return null;
        return (
          <div key={section.title ?? index} className="flex flex-col gap-1">
            {section.title && (
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">
                {section.titleKey ? t(section.titleKey) : section.title}
              </p>
            )}
            {items.map((item) =>
              item.upcoming ? (
                <span
                  key={item.to}
                  className="flex cursor-not-allowed items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-fg-subtle"
                  aria-disabled="true"
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="size-4.5" aria-hidden="true" />
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </span>
                  <Badge tone="outline" className="text-[10px]">
                    {item.upcoming}
                  </Badge>
                </span>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-soft text-primary'
                        : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                    )
                  }
                >
                  <item.icon className="size-4.5" aria-hidden="true" />
                  {item.labelKey ? t(item.labelKey) : item.label}
                </NavLink>
              ),
            )}
          </div>
        );
      })}
    </nav>
  );
}

interface DashboardShellProps {
  workspace: string;
  sections: NavSection[];
  homeLink: string;
  footer?: ReactNode;
}

export function DashboardShell({ workspace, sections, homeLink, footer }: DashboardShellProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {tr('Skip to content')}
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-border bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo to={homeLink} />
          <p className="mt-2 px-0.5 text-xs font-medium text-fg-subtle">{workspace}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SideNav sections={sections} />
        </div>
        {footer}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <div className="flex items-center gap-2 lg:hidden">
            <IconButton
              label={tr('Open navigation')}
              icon={<Menu />}
              onClick={() => setOpen(true)}
            />
            <Logo to={homeLink} />
          </div>
          <p className="hidden text-sm text-fg-subtle lg:block">
            <Link to="/" className="hover:text-fg">
              {tr('← Back to STAYSCAPE')}
            </Link>
          </p>
          <div className="flex min-w-0 items-center gap-2">
            {/* Phones: language and theme live in the navigation drawer to keep the bar narrow. */}
            <div className="hidden items-center gap-2 sm:flex">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            <UserMenu />
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-6xl animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} side="left" title={workspace}>
        <SideNav sections={sections} />
        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 sm:hidden">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </Drawer>
    </div>
  );
}
