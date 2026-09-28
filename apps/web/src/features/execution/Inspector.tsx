import { formatClockTime, formatDuration } from '@flow/shared';
import { X } from 'lucide-react';
import { JsonViewer } from '@/components/JsonViewer';
import { StatusPill } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { NODE_KIND_META } from '@/features/editor/node-registry';
import { NODE_STATUS_STYLES } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { NodeActivation } from './execution-state';

const SKIP_REASONS: Record<string, string> = {
  'branch-not-taken': 'The conditional above this node took the other branch.',
  'upstream-failed': 'A node upstream failed and stopped this path.',
  'upstream-skipped': 'Every incoming branch was skipped.',
};

/**
 * Everything known about one node activation: status, timing, attempt history, and the
 * exact payloads that went in and came out.
 */
export function Inspector({
  activation,
  onClose,
}: {
  activation: NodeActivation;
  onClose: () => void;
}) {
  const meta = NODE_KIND_META[activation.kind];
  const Icon = meta.icon;
  const failedAttempts = activation.attempts.filter((a) => a.status === 'failed').length;
  const retriesExhausted =
    activation.status === 'failed' && activation.attempt >= activation.maxAttempts && activation.maxAttempts > 1;

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface animate-slide-in">
      <header className="sticky top-0 z-10 flex items-start gap-2 border-b border-border bg-surface px-4 py-3">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)` }}
        >
          <Icon className="size-3.5" style={{ color: meta.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
            {activation.label}
          </h2>
          <p className="font-mono text-[10.5px] text-text-subtle">
            {activation.nodeId}
            {activation.activationIndex > 0 && ` · run ${activation.activationIndex + 1}`}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close inspector">
          <X />
        </Button>
      </header>

      <div className="space-y-5 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Status">
            <StatusPill status={activation.status} />
          </Stat>
          <Stat label="Duration">
            <span className="font-mono text-[13px] text-text tabular">
              {formatDuration(activation.durationMs)}
            </span>
          </Stat>
          <Stat label="Started">
            <span className="font-mono text-[13px] text-text tabular">
              {activation.startedAt ? formatClockTime(activation.startedAt) : '--'}
            </span>
          </Stat>
          <Stat label="Attempts">
            <span className="font-mono text-[13px] tabular">
              <span className={failedAttempts > 0 ? 'text-warning' : 'text-text'}>
                {activation.attempt}
              </span>
              <span className="text-text-subtle"> / {activation.maxAttempts}</span>
            </span>
          </Stat>
        </dl>

        {activation.branch && (
          <Section title="Branch taken">
            <p className="text-[13px] text-text-muted">
              Continued along{' '}
              <code className="rounded-xs bg-surface-hover px-1 py-0.5 font-mono text-[12px] text-text">
                {activation.branch}
              </code>
            </p>
          </Section>
        )}

        {activation.status === 'skipped' && (
          <Section title="Why it was skipped">
            <p className="text-[13px] text-text-muted">
              {SKIP_REASONS[activation.skipReason ?? ''] ?? 'This node never became ready.'}
            </p>
          </Section>
        )}

        {activation.error && (
          <Section title="Error">
            <div className="rounded-sm border border-[#4a2523] bg-danger-muted/50 p-2.5">
              <p className="font-mono text-[12.5px] leading-relaxed text-danger">
                {activation.error.message}
              </p>
              {activation.error.code && (
                <p className="mt-1 font-mono text-[10.5px] text-text-subtle">
                  {activation.error.code}
                </p>
              )}
            </div>
            {retriesExhausted && (
              <p className="mt-2 text-[12px] font-medium text-danger">Retries exhausted</p>
            )}
          </Section>
        )}

        <Section title="Input">
          <JsonViewer value={activation.input} emptyLabel="No input recorded" />
        </Section>

        <Section title="Output">
          <JsonViewer
            value={activation.output}
            emptyLabel={
              activation.status === 'failed'
                ? 'The node never produced output'
                : 'No output recorded'
            }
          />
        </Section>

        {activation.attempts.length > 0 && (
          <Section title="Timeline">
            <ol className="space-y-px">
              {activation.attempts.map((attempt) => {
                const style = NODE_STATUS_STYLES[attempt.status];
                return (
                  <li
                    key={attempt.attempt}
                    className="flex items-center gap-3 rounded-xs px-2 py-1.5 odd:bg-surface-raised/60"
                  >
                    <span className="w-16 shrink-0 text-[12px] text-text-muted">
                      Attempt {attempt.attempt}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-[12px] text-text-muted tabular">
                      {formatDuration(attempt.durationMs)}
                    </span>
                    <span className={cn('flex items-center gap-1 text-[12px]', style.text)}>
                      {style.glyph} {style.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            {activation.attempts.some((a) => a.error) && (
              <p className="mt-2 font-mono text-[11px] text-text-subtle">
                {activation.attempts.filter((a) => a.error).at(-1)?.error?.message}
              </p>
            )}
          </Section>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
          <Stat label="Branch depth">
            <span className="font-mono text-[13px] text-text-muted tabular">
              {activation.branchDepth}
            </span>
          </Stat>
          <Stat label="Node type">
            <span className="text-[13px] text-text-muted">{meta.label}</span>
          </Stat>
        </dl>
      </div>
    </aside>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-[11px] uppercase tracking-[0.06em] text-text-subtle">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] uppercase tracking-[0.06em] text-text-subtle">{title}</h3>
      {children}
    </section>
  );
}
