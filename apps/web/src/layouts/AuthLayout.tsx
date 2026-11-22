import { Outlet } from 'react-router';
import { BadgeCheck, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/features/ui/ThemeToggle';

const promises = [
  {
    icon: BadgeCheck,
    title: 'Verified partners',
    body: 'Every property is reviewed before it can accept bookings.',
  },
  {
    icon: LockKeyhole,
    title: 'Secure by design',
    body: 'Rotating sessions, encrypted passwords and device controls.',
  },
  {
    icon: ShieldCheck,
    title: 'Clear pricing',
    body: 'Taxes and fees are shown before you pay — no surprises.',
  },
];

export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="hero-texture relative hidden flex-col justify-between overflow-hidden p-12 text-ivory lg:flex">
        <Logo tone="inverse" />
        <div className="relative z-10 max-w-md">
          <p className="eyebrow !text-gold-300">Stays worth the journey</p>
          <h2 className="mt-4 font-display text-display-sm font-semibold">
            Travel that feels considered, from the first click.
          </h2>
          <ul className="mt-10 flex flex-col gap-6">
            {promises.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-gold-300">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="text-sm text-ivory/70">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ivory/50">© {new Date().getFullYear()} STAYSCAPE</p>
        <svg
          className="pointer-events-none absolute -right-24 -bottom-24 size-[420px] text-gold-500/15"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" />
          <circle cx="100" cy="100" r="42" fill="none" stroke="currentColor" />
        </svg>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5 sm:p-8">
          <Logo className="lg:invisible" />
          <ThemeToggle />
        </div>
        <main
          id="main"
          className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-8"
        >
          <div className="w-full max-w-md animate-rise-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
