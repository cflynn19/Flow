import { formatDuration } from '@flow/shared';
import { NODE_STATUS_STYLES } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { NodeActivation } from './execution-state';

/**
 * A Gantt chart of the run. Bars share one time axis, so branches that overlap in time
 * are visibly stacked -- which is the fastest way to see that a fan-out actually ran
 * concurrently rather than one after the other.
 */
export function Timeline({
  activations,
  startedAt,
  durationMs,
  selectedId,
  onSelect,
}: {
  activations: NodeActivation[];
  startedAt: string | null;
  durationMs: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ran = activations.filter((a) => a.startedAt !== null);

  if (!startedAt || ran.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-text-subtle">
        No node timings yet. Bars appear as nodes start.
      </p>
    );
  }

  const t0 = new Date(startedAt).getTime();
  const ends = ran.map(
    (a) => new Date(a.startedAt!).getTime() + (a.durationMs ?? 0),
  );
  const total = Math.max(durationMs ?? 0, ...ends.map((end) => end - t0), 1);
  const ticks = buildTicks(total);

  return (
    <div className="px-4 py-3">
      <div className="flex">
        <div className="w-44 shrink-0" />
        <div className="relative h-5 flex-1">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-text-subtle tabular"
              style={{ left: `${(tick / total) * 100}%` }}
            >
              {formatDuration(tick)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {ran.map((activation) => {
          const start = new Date(activation.startedAt!).getTime() - t0;
          const width = Math.max(((activation.durationMs ?? 0) / total) * 100, 0.6);
          const left = (start / total) * 100;
          const isSelected = activation.id === selectedId;

          return (
            <button
              key={activation.id}
              type="button"
              onClick={() => onSelect(activation.id)}
              className={cn(
                'flex w-full items-center rounded-xs py-0.5 text-left transition-colors',
                isSelected ? 'bg-surface-hover' : 'hover:bg-surface-raised',
              )}
            >
              <span className="flex w-44 shrink-0 items-center gap-1.5 pr-3">
                <span className={cn('text-[10px]', NODE_STATUS_STYLES[activation.status].text)}>
                  {NODE_STATUS_STYLES[activation.status].glyph}
                </span>
                <span className="truncate text-[12px] text-text-muted">{activation.label}</span>
                {activation.activationIndex > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-warning">
                    #{activation.activationIndex + 1}
                  </span>
                )}
              </span>

              <span className="relative h-4 flex-1">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    className="absolute inset-y-0 w-px bg-border/60"
                    style={{ left: `${(tick / total) * 100}%` }}
                  />
                ))}

                <span
                  className="absolute inset-y-0 flex items-stretch overflow-hidden rounded-[2px]"
                  style={{ left: `${left}%`, width: `${width}%`, minWidth: 3 }}
                  title={`${activation.label} — ${formatDuration(activation.durationMs)}`}
                >
                  {/* Each attempt is its own segment, so a retried node shows its history. */}
                  {activation.attempts.length > 1 ? (
                    activation.attempts.map((attempt, index) => (
                      <span
                        key={index}
                        className={cn(
                          'h-full',
                          attempt.status === 'failed'
                            ? NODE_STATUS_STYLES.failed.fill
                            : NODE_STATUS_STYLES.success.fill,
                          index > 0 && 'border-l border-canvas',
                        )}
                        style={{
                          flex: `${Math.max(attempt.durationMs, 1)} 0 auto`,
                        }}
                      />
                    ))
                  ) : (
                    <span
                      className={cn(
                        'h-full w-full',
                        NODE_STATUS_STYLES[activation.status].fill,
                        activation.status === 'running' && 'animate-pulse-ring',
                      )}
                    />
                  )}
                </span>
              </span>

              <span className="w-16 shrink-0 pl-3 text-right font-mono text-[11px] text-text-subtle tabular">
                {formatDuration(activation.durationMs)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Round tick marks so the axis reads 0 / 500ms / 1.00s rather than arbitrary numbers. */
function buildTicks(totalMs: number): number[] {
  const targetCount = 5;
  const rough = totalMs / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;

  const ticks: number[] = [];
  for (let value = 0; value <= totalMs; value += step) ticks.push(Math.round(value));
  return ticks;
}
