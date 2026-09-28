import { formatDuration } from '@flow/shared';
import { useEffect, useRef, useState } from 'react';
import { NODE_STATUS_STYLES, type RunState } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * A looping, self-contained replay of a signup workflow. It is a scripted animation, not
 * a screenshot -- it shows the exact node states, retry behaviour and timeline the real
 * app produces, without needing an account or a server.
 */

interface Step {
  at: number;
  node: string;
  status: RunState;
  duration?: number;
}

const NODES = [
  { id: 'signup', label: 'User Signup', row: 1, col: 0 },
  { id: 'auth', label: 'Authenticate', row: 1, col: 1 },
  { id: 'create', label: 'Create User', row: 1, col: 2 },
  { id: 'email', label: 'Send Email', row: 0, col: 3 },
  { id: 'recs', label: 'Recommendations', row: 2, col: 3 },
  { id: 'end', label: 'End', row: 1, col: 4 },
];

const EDGES: [string, string][] = [
  ['signup', 'auth'],
  ['auth', 'create'],
  ['create', 'email'],
  ['create', 'recs'],
  ['email', 'end'],
  ['recs', 'end'],
];

const SCRIPT: Step[] = [
  { at: 200, node: 'signup', status: 'running' },
  { at: 320, node: 'signup', status: 'success', duration: 120 },
  { at: 360, node: 'auth', status: 'running' },
  { at: 560, node: 'auth', status: 'success', duration: 200 },
  { at: 600, node: 'create', status: 'running' },
  { at: 900, node: 'create', status: 'success', duration: 300 },
  { at: 940, node: 'email', status: 'running' },
  { at: 950, node: 'recs', status: 'running' },
  { at: 1450, node: 'email', status: 'retrying' },
  { at: 1700, node: 'email', status: 'running' },
  { at: 1930, node: 'email', status: 'success', duration: 990 },
  { at: 2100, node: 'recs', status: 'success', duration: 1150 },
  { at: 2200, node: 'end', status: 'running' },
  { at: 2300, node: 'end', status: 'success', duration: 100 },
];

const LOOP_MS = 3600;

export function LandingDemo() {
  const [applied, setApplied] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const frame = useRef(0);
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    // With reduced motion the demo shows its finished state instead of animating.
    if (reducedMotion) {
      setApplied(SCRIPT.length);
      setElapsed(2300);
      return;
    }

    let start = performance.now();
    let lastApplied = -1;

    const tick = (now: number) => {
      const time = (now - start) % LOOP_MS;
      if (time < 200 && lastApplied > 0) {
        start = now;
        lastApplied = -1;
      }

      const count = SCRIPT.filter((step) => step.at <= time).length;
      // Only re-render when a step lands; the clock ticks at a readable 10fps.
      if (count !== lastApplied) {
        lastApplied = count;
        setApplied(count);
      }
      setElapsed(Math.round(time / 100) * 100);

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [reducedMotion]);

  const states: Record<string, { status: RunState; duration?: number }> = {};
  for (const step of SCRIPT.slice(0, applied)) {
    states[step.node] = { status: step.status, duration: step.duration };
  }

  const isDone =
    Object.values(states).filter((state) => state.status === 'success').length === NODES.length;
  const running = NODES.find((n) => states[n.id]?.status === 'running');

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_64px_-24px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-[12px] text-text-muted">#1842</span>
        <span className="text-[12.5px] text-text">Signup Pipeline</span>
        <span
          className={cn(
            'rounded-xs px-1.5 py-0.5 text-[11px] font-medium',
            isDone ? NODE_STATUS_STYLES.success.chip : NODE_STATUS_STYLES.running.chip,
          )}
        >
          {isDone ? '✓ Success' : '◐ Running'}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11.5px] text-text-subtle tabular">
          {formatDuration(Math.min(elapsed, 2300))}
        </span>
      </div>

      <div
        className="relative bg-canvas p-5"
        style={{
          backgroundImage: 'radial-gradient(circle, #1d1d23 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <svg className="absolute inset-0 size-full" aria-hidden>
          {EDGES.map(([from, to]) => {
            const a = NODES.find((n) => n.id === from)!;
            const b = NODES.find((n) => n.id === to)!;
            const active = states[to]?.status === 'running' || states[to]?.status === 'retrying';
            const done = states[to]?.status === 'success';
            return (
              <line
                key={`${from}-${to}`}
                x1={`${a.col * 19.5 + 16}%`}
                y1={`${a.row * 33 + 20}%`}
                x2={`${b.col * 19.5 + 3}%`}
                y2={`${b.row * 33 + 20}%`}
                stroke={active ? 'var(--color-running)' : done ? '#3d5a44' : '#2c2c34'}
                strokeWidth="1.5"
                strokeDasharray={active ? '5 7' : undefined}
                className={active ? 'animate-dash' : undefined}
              />
            );
          })}
        </svg>

        <div className="relative grid grid-rows-3 gap-3" style={{ minHeight: 190 }}>
          {[0, 1, 2].map((row) => (
            <div key={row} className="relative">
              {NODES.filter((node) => node.row === row).map((node) => {
                const state = states[node.id];
                const style = NODE_STATUS_STYLES[state?.status ?? 'pending'];
                const isActive = state?.status === 'running' || state?.status === 'retrying';
                return (
                  <div
                    key={node.id}
                    className={cn(
                      'absolute w-[17%] min-w-[104px] rounded-md border bg-surface-raised px-2 py-1.5 transition-colors duration-200',
                      state ? style.ring : 'border-border',
                      isActive && 'shadow-[0_0_0_3px_rgba(88,166,255,0.12)]',
                    )}
                    style={{ left: `${node.col * 19.5}%` }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'text-[10px] leading-none',
                          style.text,
                          isActive && 'animate-pulse-ring',
                        )}
                      >
                        {style.glyph}
                      </span>
                      <span className="truncate text-[11.5px] font-medium text-text">
                        {node.label}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-text-subtle tabular">
                      {state?.duration ? formatDuration(state.duration) : '—'}
                      {state?.status === 'retrying' && (
                        <span className="ml-1 text-warning">retry 2/3</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-3 py-2">
        <p className="font-mono text-[11px] text-text-subtle">
          {states.email?.status === 'retrying' ? (
            <span className="text-warning">node.retrying · Send Email · SMTP timeout</span>
          ) : isDone ? (
            <span className="text-success">workflow.completed · 6 succeeded in 2.30s</span>
          ) : (
            <span className="text-running">
              {running ? `node.started · ${running.label}` : 'workflow.started · Signup Pipeline'}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
