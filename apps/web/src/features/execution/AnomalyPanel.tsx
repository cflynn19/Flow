import type { Anomaly } from '@flow/shared';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const SEVERITY = {
  critical: { icon: ShieldAlert, className: 'text-danger', border: 'border-[#4a2523]' },
  warning: { icon: AlertTriangle, className: 'text-warning', border: 'border-[#443519]' },
  info: { icon: Info, className: 'text-running', border: 'border-[#1d3350]' },
} as const;

/**
 * Deterministic findings from the run. Every one names what was observed, what was
 * expected, and the usual causes -- the goal is a lead to follow, not a verdict.
 */
export function AnomalyPanel({
  anomalies,
  onSelectNode,
}: {
  anomalies: Anomaly[];
  onSelectNode?: (nodeId: string) => void;
}) {
  if (anomalies.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-text-subtle">
        Nothing unusual. Node counts, retries and durations all sit inside the expected
        range for this workflow.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-4">
      {anomalies.map((anomaly, index) => {
        const severity = SEVERITY[anomaly.severity];
        const Icon = severity.icon;

        return (
          <div
            key={`${anomaly.rule}-${anomaly.nodeId}-${index}`}
            className={cn('rounded-md border bg-surface-raised p-3', severity.border)}
          >
            <div className="flex items-start gap-2.5">
              <Icon className={cn('mt-px size-4 shrink-0', severity.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">{anomaly.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
                  {anomaly.detail}
                </p>

                <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]">
                  <div className="flex gap-1.5">
                    <dt className="text-text-subtle">observed</dt>
                    <dd className={severity.className}>{anomaly.observed}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-text-subtle">expected</dt>
                    <dd className="text-text-muted">{anomaly.expected}</dd>
                  </div>
                </dl>

                {anomaly.causes.length > 0 && (
                  <div className="mt-2.5">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-text-subtle">
                      Possible causes
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {anomaly.causes.map((cause) => (
                        <li key={cause} className="text-[12.5px] text-text-muted">
                          <span className="mr-1.5 text-text-subtle">•</span>
                          {cause}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {anomaly.nodeId && onSelectNode && (
                  <button
                    type="button"
                    onClick={() => onSelectNode(anomaly.nodeId!)}
                    className="mt-2.5 text-[12px] text-accent hover:underline underline-offset-4"
                  >
                    Inspect node →
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
