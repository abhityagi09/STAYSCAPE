import { Link } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  Building,
  Building2,
  House,
  Leaf,
  Sparkles,
  TreePalm,
  Hotel,
  ShieldCheck,
  ReceiptText,
} from 'lucide-react';
import { ButtonLink, EmptyState } from '@/components/ui';
import { CATEGORIES, DESTINATIONS, TRAVEL_NOTES } from './sections/content';
import { Newsletter } from './sections/Newsletter';
import { SearchForm } from './sections/SearchForm';

const categoryIcons = {
  hotels: Hotel,
  resorts: TreePalm,
  villas: House,
  boutique: Sparkles,
  homestays: Leaf,
  apartments: Building,
} as const;

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
        {description && <p className="mt-3 text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section
        aria-labelledby="hero-title"
        className="hero-texture relative overflow-hidden pt-[72px] text-ivory"
      >
        <svg
          className="pointer-events-none absolute top-24 -right-40 size-[640px] text-gold-500/10"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          {[96, 76, 56, 36].map((r) => (
            <circle
              key={r}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          ))}
        </svg>
        <div className="container-page relative pt-20 pb-40 sm:pt-28 lg:pb-48">
          <p className="eyebrow animate-rise-in !text-gold-300">Verified stays · Honest prices</p>
          <h1
            id="hero-title"
            className="mt-5 max-w-3xl animate-rise-in font-display text-display-sm font-semibold tracking-tight [animation-delay:60ms] sm:text-display-md lg:text-display-lg"
          >
            Stays worth the journey.
          </h1>
          <p className="mt-6 max-w-xl animate-rise-in text-lg text-ivory/75 [animation-delay:120ms]">
            Discover hotels, resorts and boutique stays across India — each one reviewed before it
            can take a booking, with every fee shown upfront.
          </p>
        </div>
      </section>
      <div className="container-page relative z-10 -mt-28 lg:-mt-32">
        <SearchForm className="animate-rise-in [animation-delay:180ms]" />
      </div>

      {/* Trust strip */}
      <section
        aria-label="Why STAYSCAPE"
        className="container-page mt-12 grid gap-6 sm:grid-cols-3"
      >
        {[
          {
            icon: BadgeCheck,
            title: 'Every partner verified',
            body: 'Business and property checks before listings go live.',
          },
          {
            icon: ReceiptText,
            title: 'All-in pricing',
            body: 'Taxes and fees itemised before you pay.',
          },
          {
            icon: ShieldCheck,
            title: 'Your account, protected',
            body: 'Device sessions you can see and revoke.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3">
            <Icon
              className="mt-0.5 size-5 shrink-0 text-gold-600 dark:text-gold-400"
              aria-hidden="true"
            />
            <p className="text-sm">
              <span className="font-semibold text-fg">{title}.</span>{' '}
              <span className="text-fg-muted">{body}</span>
            </p>
          </div>
        ))}
      </section>

      {/* Categories */}
      <section aria-labelledby="categories-title" className="container-page mt-24">
        <SectionHeading
          id="categories-title"
          eyebrow="Browse by style"
          title="Find the stay that fits the trip"
        />
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((category) => {
            const Icon = categoryIcons[category.slug];
            return (
              <li key={category.slug}>
                <Link
                  to={`/search?category=${category.slug}`}
                  className="group flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="font-semibold text-fg">{category.label}</span>
                  <span className="text-xs text-fg-muted">{category.blurb}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Destinations */}
      <section
        id="destinations"
        aria-labelledby="destinations-title"
        className="container-page mt-24 scroll-mt-24"
      >
        <SectionHeading
          id="destinations-title"
          eyebrow="Destinations"
          title="Places we're curating first"
          description="We're onboarding partners region by region. These are the first destinations on our list."
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((destination, index) => (
            <li key={destination.name}>
              <Link
                to={`/search?destination=${encodeURIComponent(destination.name)}`}
                className={`group relative flex min-h-64 flex-col justify-end overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-ivory shadow-md transition-transform duration-500 hover:-translate-y-1 ${destination.tint} ${index === 0 ? 'lg:row-span-2 lg:min-h-[34rem]' : ''}`}
              >
                <svg
                  className="absolute -top-10 -right-10 size-56 text-white/10 transition-transform duration-700 group-hover:scale-110"
                  viewBox="0 0 100 100"
                  aria-hidden="true"
                >
                  <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" />
                  <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" />
                </svg>
                <p className="text-xs font-semibold tracking-[0.18em] text-gold-300 uppercase">
                  {destination.region}
                </p>
                <h3 className="mt-2 font-display text-3xl font-semibold">{destination.name}</h3>
                <p className="mt-2 max-w-xs text-sm text-ivory/80">{destination.note}</p>
                <p className="mt-4 text-xs text-ivory/60">Best season · {destination.season}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Featured accommodation — real data only */}
      <section aria-labelledby="featured-title" className="container-page mt-24">
        <SectionHeading
          id="featured-title"
          eyebrow="Featured stays"
          title="Hand-picked accommodation"
        />
        <EmptyState
          icon={<Building2 />}
          title="Our first verified stays are on their way"
          description="We only feature properties that have passed verification and can take real bookings. None are live yet — when they are, they'll appear right here."
          action={
            <ButtonLink
              to="/partners"
              variant="outline"
              size="sm"
              rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
            >
              Own a property? Join early
            </ButtonLink>
          }
        />
      </section>

      {/* Promotions */}
      <section
        aria-label="Get started"
        className="container-page mt-24 grid gap-5 lg:grid-cols-[1.3fr_1fr]"
      >
        <div className="relative overflow-hidden rounded-3xl bg-forest-900 p-8 text-ivory sm:p-12">
          <p className="eyebrow !text-gold-300">For property owners</p>
          <h2 className="mt-3 max-w-md font-display text-3xl font-semibold">
            Bring your property to travellers who value it.
          </h2>
          <p className="mt-3 max-w-md text-ivory/75">
            Transparent onboarding, your own staff permissions, and verification that builds guest
            trust.
          </p>
          <ButtonLink
            to="/partners"
            variant="accent"
            className="mt-8"
            rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            See how onboarding works
          </ButtonLink>
          <Building2
            className="absolute -right-6 -bottom-6 size-48 text-white/5"
            aria-hidden="true"
          />
        </div>
        <div className="flex flex-col justify-between rounded-3xl border border-border bg-accent-soft p-8 sm:p-12">
          <div>
            <p className="eyebrow">For travellers</p>
            <h2 className="mt-3 font-display text-3xl font-semibold">Create your free account</h2>
            <p className="mt-3 text-fg-muted">
              Set your currency and language, control notifications and be ready to book as stays go
              live.
            </p>
          </div>
          <ButtonLink to="/register" className="mt-8 w-fit">
            Create account
          </ButtonLink>
        </div>
      </section>

      {/* Inspiration */}
      <section
        id="inspiration"
        aria-labelledby="inspiration-title"
        className="container-page mt-24 scroll-mt-24"
      >
        <SectionHeading
          id="inspiration-title"
          eyebrow="Travel notes"
          title="A little inspiration before you go"
        />
        <ul className="grid gap-5 md:grid-cols-3">
          {TRAVEL_NOTES.map((note) => (
            <li
              key={note.title}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6"
            >
              <span className="w-fit rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                {note.tag}
              </span>
              <h3 className="font-display text-xl font-semibold">{note.title}</h3>
              <p className="text-sm leading-relaxed text-fg-muted">{note.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <Newsletter />
    </>
  );
}
