import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Compass, Lock, TriangleAlert } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button, ButtonLink } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { tr } from '@/lib/tr';

function StatusLayout({
  code,
  icon,
  title,
  body,
  actions,
}: {
  code: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="container-page flex min-h-[70vh] flex-col items-center justify-center gap-6 py-20 text-center">
      <span
        className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-8"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="font-mono text-sm tracking-widest text-fg-subtle">{code}</p>
      <h1 className="max-w-xl font-display text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-fg-muted">{body}</p>
      <div className="flex flex-wrap justify-center gap-3">{actions}</div>
    </div>
  );
}

export default function NotFoundPage() {
  return (
    <StatusLayout
      code="404"
      icon={<Compass />}
      title={tr('This page has wandered off')}
      body="The link may be broken or the page may have moved."
      actions={
        <>
          <ButtonLink to="/">{tr('Back to home')}</ButtonLink>
          <ButtonLink to="/search" variant="outline">
            {tr('Find a stay')}
          </ButtonLink>
        </>
      }
    />
  );
}

export function ForbiddenPage() {
  const { isAuthenticated } = useAuth();
  return (
    <StatusLayout
      code="403"
      icon={<Lock />}
      title={tr("You don't have access to this area")}
      body="Your account doesn't include the permissions this page requires. If you think that's a mistake, contact your administrator."
      actions={
        <>
          <ButtonLink to={isAuthenticated ? '/account' : '/login'}>
            {isAuthenticated ? tr('Go to my account') : tr('Sign in')}
          </ButtonLink>
          <ButtonLink to="/" variant="outline">
            {tr('Home')}
          </ButtonLink>
        </>
      }
    />
  );
}

/** Route-level error boundary (render errors and failed lazy chunk loads). */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="min-h-dvh bg-bg">
      <div className="container-page pt-8">
        <Logo />
      </div>
      <StatusLayout
        code="ERROR"
        icon={<TriangleAlert />}
        title={tr('Something went wrong')}
        body="An unexpected error interrupted this page. Reloading usually fixes it — if not, please try again later."
        actions={
          <>
            <Button onClick={() => window.location.reload()}>{tr('Reload page')}</Button>
            <ButtonLink to="/" variant="outline" reloadDocument>
              {tr('Back to home')}
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}
