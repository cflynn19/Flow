import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FlowMark } from '@/components/AppShell';
import { GithubIcon } from '@/components/GithubIcon';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { LandingDemo } from './LandingDemo';

// Swap YOUR_USERNAME for the real owner once the repo is public.
const REPO_URL = 'https://github.com/YOUR_USERNAME/flow';

const POINTS = [
  {
    title: 'Watch it happen',
    body: 'Nodes change state on the canvas as the engine reaches them. Retries, branches and failures appear the moment they occur, over a persisted event stream.',
  },
  {
    title: 'See concurrency',
    body: 'A shared-axis timeline shows which branches actually overlapped, and where a slow node held everything else up.',
  },
  {
    title: 'Inspect every attempt',
    body: 'Each node records its input, output, error and attempt history — so “it failed” becomes “SMTP timeout on attempts 1 and 2, succeeded on 3”.',
  },
];

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-6">
        <FlowMark />
        <span className="text-[14px] font-semibold tracking-tight text-text">Flow</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" asChild>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            <GithubIcon />
            GitHub
          </a>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link to={user ? '/app' : '/login'}>{user ? 'Open app' : 'Sign in'}</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="pt-16 pb-10 text-center sm:pt-24">
          <h1 className="mx-auto max-w-2xl text-balance text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] text-text sm:text-[46px]">
            Understand what your workflows actually did.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-[15px] leading-relaxed text-text-muted">
            Flow is an open-source visual debugger for asynchronous workflows and agent
            systems.
          </p>

          <div className="mt-7 flex items-center justify-center gap-2.5">
            <Button variant="primary" size="lg" asChild>
              <Link to={user ? '/app' : '/login'}>
                Try the demo
                <ArrowRight />
              </Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                <GithubIcon />
                View on GitHub
              </a>
            </Button>
          </div>
        </section>

        <section aria-label="Live demonstration" className="pb-14">
          <LandingDemo />
        </section>

        <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border pb-px sm:grid-cols-3">
          {POINTS.map((point) => (
            <div key={point.title} className="bg-surface p-5">
              <h2 className="text-[13.5px] font-semibold text-text">{point.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{point.body}</p>
            </div>
          ))}
        </section>

        <footer className="flex flex-col items-center gap-1 py-12 text-center">
          <p className="text-[12.5px] text-text-subtle">
            Runs entirely on your machine. React · Fastify · PostgreSQL · SSE.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[12.5px] text-text-muted hover:text-text"
          >
            Open source, MIT licensed
          </a>
        </footer>
      </main>
    </div>
  );
}
