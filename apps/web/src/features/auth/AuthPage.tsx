import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { FlowMark } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from './AuthContext';

const DEMO = { email: 'demo@flow.dev', password: 'flowdemo123' };

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, isLoading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Where RequireAuth sent us from, so a deep link survives the detour through /login.
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (!isLoading && user) return <Navigate to={from} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') await signIn(email, password);
      else await signUp(email, password, name);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err
          : new ApiRequestError(0, 'unknown', 'Something went wrong. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = async () => {
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    setError(null);
    setSubmitting(true);
    try {
      await signIn(DEMO.email, DEMO.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? new ApiRequestError(
              err.status,
              err.code,
              'The demo account is not set up. Run `npm run db:seed` first.',
            )
          : null,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[21rem]">
        <Link to="/" className="mb-7 flex items-center justify-center gap-2">
          <FlowMark className="size-6" />
          <span className="text-[17px] font-semibold tracking-tight text-text">Flow</span>
        </Link>

        <div className="rounded-lg border border-border bg-surface p-5">
          <h1 className="text-[15px] font-semibold text-text">
            {mode === 'login' ? 'Sign in to Flow' : 'Create your account'}
          </h1>
          <p className="mt-0.5 text-[13px] text-text-muted">
            {mode === 'login'
              ? 'Pick up where your workflows left off.'
              : 'Free, local, and yours. No email verification.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3.5">
            {mode === 'register' && (
              <div>
                <Label htmlFor="name" className="mb-1.5 block">
                  Name
                </Label>
                <Input
                  id="name"
                  required
                  autoFocus
                  autoComplete="name"
                  value={name}
                  aria-invalid={Boolean(error?.fieldError('name'))}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError message={error?.fieldError('name')} />
              </div>
            )}

            <div>
              <Label htmlFor="email" className="mb-1.5 block">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                required
                autoFocus={mode === 'login'}
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(error?.fieldError('email'))}
                onChange={(event) => setEmail(event.target.value)}
              />
              <FieldError message={error?.fieldError('email')} />
            </div>

            <div>
              <Label htmlFor="password" className="mb-1.5 block">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                aria-invalid={Boolean(error?.fieldError('password'))}
                onChange={(event) => setPassword(event.target.value)}
              />
              <FieldError message={error?.fieldError('password')} />
              {mode === 'register' && !error?.fieldError('password') && (
                <p className="mt-1 text-[11.5px] text-text-subtle">At least 8 characters.</p>
              )}
            </div>

            {error && !error.details?.length && (
              <p
                role="alert"
                className="rounded-sm border border-[#4a2523] bg-danger-muted/50 px-3 py-2 text-[12.5px] text-danger"
              >
                {error.message}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
              {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {mode === 'login' && (
            <>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.06em] text-text-subtle">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => void fillDemo()}
                disabled={submitting}
              >
                Use the demo account
              </Button>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[13px] text-text-muted">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <Link to="/register" className="text-accent hover:underline underline-offset-4">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have one?{' '}
              <Link to="/login" className="text-accent hover:underline underline-offset-4">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[12px] text-danger">{message}</p>;
}
