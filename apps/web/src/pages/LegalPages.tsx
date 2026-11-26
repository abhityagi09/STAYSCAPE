import type { ReactNode } from 'react';
import { Alert, ButtonLink, PageHeader } from '@/components/ui';
import { tr, trf } from '@/lib/tr';

function LegalDocument({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="container-page max-w-3xl py-16">
      <PageHeader
        eyebrow={tr('Legal')}
        title={title}
        description={trf('Last updated {0}', [updated])}
      />
      <Alert tone="warning" title={tr('Draft pending legal review')} className="mb-10">
        {tr(
          'This document describes how STAYSCAPE is designed to operate. It has not yet been reviewed by counsel and will be finalised before public launch.',
        )}
      </Alert>
      <div className="flex flex-col gap-8 text-[15px] leading-relaxed text-fg-muted [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalDocument title={tr('Terms of service')} updated="22 November 2026">
      <section>
        <h2>{tr('1. About STAYSCAPE')}</h2>
        <p>
          {tr(
            'STAYSCAPE is a marketplace that connects travellers with independent accommodation providers (“partners”). Partners — not STAYSCAPE — provide the accommodation and are responsible for the stay itself.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('2. Your account')}</h2>
        <ul>
          <li>{tr('You must provide accurate information and keep it up to date.')}</li>
          <li>
            {tr(
              'You are responsible for activity on your account. Keep your password confidential and sign out of devices you no longer use.',
            )}
          </li>
          <li>{tr('You must be at least 18 years old to create an account and make bookings.')}</li>
        </ul>
      </section>
      <section>
        <h2>{tr('3. Bookings and payments')}</h2>
        <p>
          {tr(
            'When booking opens, each rate will display its total price, taxes, fees and cancellation policy before you pay. A booking is confirmed only when you receive a confirmation from STAYSCAPE.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('4. Partner obligations')}</h2>
        <p>
          {tr(
            'Partners must hold all licences required to operate their property, describe it accurately, honour confirmed bookings and keep availability and prices current.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('5. Acceptable use')}</h2>
        <ul>
          <li>
            {tr(
              'No fraudulent bookings, misuse of payment methods or attempts to circumvent security controls.',
            )}
          </li>
          <li>{tr('No automated scraping or interference with the service.')}</li>
          <li>{tr('No unlawful, abusive or misleading content in reviews or messages.')}</li>
        </ul>
      </section>
      <section>
        <h2>{tr('6. Suspension')}</h2>
        <p>
          {tr(
            'We may suspend accounts that breach these terms or present a security risk. Where appropriate we will explain why and how to appeal.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('7. Changes')}</h2>
        <p>
          {tr('We will notify you of material changes to these terms before they take effect.')}
        </p>
      </section>
    </LegalDocument>
  );
}

export function PrivacyPage() {
  return (
    <LegalDocument title={tr('Privacy policy')} updated="22 November 2026">
      <section>
        <h2>{tr('What we collect')}</h2>
        <ul>
          <li>
            {tr(
              'Account details you provide: name, email address, optional mobile number and profile photo.',
            )}
          </li>
          <li>{tr('Preferences: language, display currency and notification choices.')}</li>
          <li>
            {tr(
              'Security data: sign-in times, device descriptions and IP addresses for active sessions, and an audit log of security-relevant actions.',
            )}
          </li>
        </ul>
      </section>
      <section>
        <h2>{tr('How we protect it')}</h2>
        <ul>
          <li>
            {tr('Passwords are hashed with Argon2id and are never stored or logged in plain text.')}
          </li>
          <li>{tr('Session tokens are stored only as one-way hashes and rotate on every use.')}</li>
          <li>{tr('Audit logs exclude passwords, tokens and payment secrets.')}</li>
        </ul>
      </section>
      <section>
        <h2>{tr('How we use it')}</h2>
        <p>
          {tr(
            'To operate your account, secure it, send messages you have asked for (such as verification and password reset emails) and, once available, process bookings. Marketing email is sent only if you opt in.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('Your choices')}</h2>
        <p>
          {tr(
            'You can update your profile and notification preferences at any time, review and revoke active sessions, and unsubscribe from marketing. Contact us to request a copy or deletion of your data.',
          )}
        </p>
      </section>
      <section>
        <h2>{tr('Cookies')}</h2>
        <p>
          {tr(
            'We use a strictly necessary, HttpOnly session cookie to keep you signed in and a companion security cookie to protect against cross-site request forgery. Your theme choice is stored in your browser.',
          )}
        </p>
      </section>
    </LegalDocument>
  );
}

export function PartnersLandingPage() {
  return (
    <div className="container-page max-w-4xl py-16">
      <PageHeader
        eyebrow={tr('For partners')}
        title={tr('List your property on STAYSCAPE')}
        description={tr(
          'We are onboarding a first group of hotels, resorts, villas and homestays. Here is how it will work.',
        )}
      />
      <ol className="mt-4 grid gap-4 sm:grid-cols-2">
        {[
          [
            'Create your account',
            'Sign up and verify your email address. This account owns your partner profile.',
          ],
          [
            'Tell us about your business',
            'Legal entity, tax registration and payout details for verification.',
          ],
          [
            'Build your listing',
            'Photos, room types, amenities, policies and nightly rates in your currency.',
          ],
          [
            'Get verified, then go live',
            'Our team reviews documents and the listing before travellers can book.',
          ],
        ].map(([title, body], index) => (
          <li key={title} className="rounded-2xl border border-border bg-surface p-6">
            <p className="font-mono text-sm text-gold-600 dark:text-gold-400">0{index + 1}</p>
            <h2 className="mt-2 font-display text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink to="/partner/onboarding">{tr('Start onboarding')}</ButtonLink>
        <ButtonLink to="/register" variant="outline">
          {tr('Create an account first')}
        </ButtonLink>
      </div>
    </div>
  );
}
