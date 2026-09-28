import { formatPercent, type NodeConfig, type NodeKind } from '@flow/shared';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { NODE_KIND_META } from './node-registry';
import type { WorkflowNodeType } from './WorkflowNode';

interface Props {
  node: WorkflowNodeType;
  /** How many edges point at this node -- join mode only matters when there is a join. */
  inboundCount: number;
  onChange: (patch: { label?: string; description?: string; config?: NodeConfig }) => void;
  onDelete: () => void;
}

/**
 * Editor for the selected node. The simulation controls at the bottom are what make the
 * demo interesting: they are how a workflow is made to fail and retry on purpose.
 */
export function NodeConfigPanel({ node, inboundCount, onChange, onDelete }: Props) {
  const config = node.data.config;
  const meta = NODE_KIND_META[node.type as NodeKind];
  const Icon = meta.icon;
  const sim = config.simulation;

  const patchConfig = (patch: Record<string, unknown>) =>
    onChange({ config: { ...config, ...patch } as NodeConfig });

  const patchSim = (patch: Partial<typeof sim>) =>
    patchConfig({ simulation: { ...sim, ...patch } });

  return (
    <aside className="flex w-[19rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-xs"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)` }}
        >
          <Icon className="size-3.5" style={{ color: meta.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text">{node.data.label}</p>
          <p className="font-mono text-[10.5px] text-text-subtle">{node.id}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete node">
          <Trash2 className="text-danger" />
        </Button>
      </header>

      <div className="space-y-4 p-3">
        <Field label="Label" htmlFor="node-label">
          <Input
            id="node-label"
            value={node.data.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="node-description">
          <Textarea
            id="node-description"
            rows={2}
            placeholder="What does this step do?"
            value={node.data.description ?? ''}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>

        {config.kind === 'action' && (
          <>
            <Field label="Operation" htmlFor="node-operation" hint="Shapes the simulated output and errors">
              <Input
                id="node-operation"
                value={config.operation}
                onChange={(event) => patchConfig({ operation: event.target.value })}
              />
            </Field>
            <Field label="Tool calls" htmlFor="node-tools" hint="Recorded per run for agent analysis">
              <Input
                id="node-tools"
                type="number"
                min={0}
                max={50}
                value={config.toolCalls}
                onChange={(event) => patchConfig({ toolCalls: clampInt(event.target.value, 0, 50) })}
              />
            </Field>
          </>
        )}

        {config.kind === 'delay' && (
          <Field label="Wait" htmlFor="node-delay" hint="Milliseconds">
            <Input
              id="node-delay"
              type="number"
              min={0}
              max={120000}
              step={100}
              value={config.durationMs}
              onChange={(event) => patchConfig({ durationMs: clampInt(event.target.value, 0, 120000) })}
            />
          </Field>
        )}

        {config.kind === 'trigger' && (
          <Field label="Trigger payload" htmlFor="node-payload" hint="JSON handed to the first nodes">
            <JsonField
              id="node-payload"
              value={config.payload}
              onChange={(payload) => patchConfig({ payload })}
            />
          </Field>
        )}

        {config.kind === 'conditional' && (
          <>
            <Field label="Mode" htmlFor="node-mode">
              <Select value={config.mode} onValueChange={(mode) => patchConfig({ mode })}>
                <SelectTrigger id="node-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expression">Compare a field</SelectItem>
                  <SelectItem value="probability">Random chance</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {config.mode === 'expression' ? (
              <>
                <Field label="Field path" htmlFor="node-path" hint="Dot path into the incoming payload">
                  <Input
                    id="node-path"
                    placeholder="user.plan"
                    value={config.path}
                    onChange={(event) => patchConfig({ path: event.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Operator" htmlFor="node-operator">
                    <Select
                      value={config.operator}
                      onValueChange={(operator) => patchConfig({ operator })}
                    >
                      <SelectTrigger id="node-operator">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="truthy">is truthy</SelectItem>
                        <SelectItem value="exists">exists</SelectItem>
                        <SelectItem value="eq">equals</SelectItem>
                        <SelectItem value="ne">not equals</SelectItem>
                        <SelectItem value="gt">greater than</SelectItem>
                        <SelectItem value="lt">less than</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Value" htmlFor="node-value">
                    <Input
                      id="node-value"
                      value={config.value}
                      disabled={config.operator === 'truthy' || config.operator === 'exists'}
                      onChange={(event) => patchConfig({ value: event.target.value })}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <SliderField
                label="Chance of taking the true branch"
                value={config.probability}
                display={formatPercent(config.probability)}
                min={0}
                max={1}
                step={0.05}
                onChange={(probability) => patchConfig({ probability })}
              />
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="True label" htmlFor="node-true">
                <Input
                  id="node-true"
                  value={config.trueLabel}
                  onChange={(event) => patchConfig({ trueLabel: event.target.value })}
                />
              </Field>
              <Field label="False label" htmlFor="node-false">
                <Input
                  id="node-false"
                  value={config.falseLabel}
                  onChange={(event) => patchConfig({ falseLabel: event.target.value })}
                />
              </Field>
            </div>
          </>
        )}

        {inboundCount > 1 && (
          <Field
            label="Wait for"
            htmlFor="node-join"
            hint="“Any branch” lets this node act as a loop entry point"
          >
            <Select value={config.joinMode} onValueChange={(joinMode) => patchConfig({ joinMode })}>
              <SelectTrigger id="node-join">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All incoming branches</SelectItem>
                <SelectItem value="any">Any incoming branch</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <div className="border-t border-border p-3">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
          Simulation
        </h3>

        <div className="space-y-4">
          <SliderField
            label="Failure probability"
            value={sim.failureProbability}
            display={formatPercent(sim.failureProbability)}
            min={0}
            max={1}
            step={0.05}
            onChange={(failureProbability) => patchSim({ failureProbability })}
          />

          <div>
            <Label className="mb-1.5 block">Duration range</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                aria-label="Minimum duration"
                value={sim.minDurationMs}
                onChange={(event) =>
                  patchSim({ minDurationMs: clampInt(event.target.value, 0, 120000) })
                }
              />
              <span className="text-[11px] text-text-subtle">to</span>
              <Input
                type="number"
                min={0}
                aria-label="Maximum duration"
                value={sim.maxDurationMs}
                onChange={(event) =>
                  patchSim({ maxDurationMs: clampInt(event.target.value, 0, 120000) })
                }
              />
              <span className="shrink-0 text-[11px] text-text-subtle">ms</span>
            </div>
          </div>

          <SliderField
            label="Retries"
            value={sim.maxRetries}
            display={sim.maxRetries === 0 ? 'none' : `${sim.maxRetries}`}
            min={0}
            max={5}
            step={1}
            onChange={(maxRetries) => patchSim({ maxRetries })}
          />

          <label className="flex items-center justify-between gap-3 pt-0.5">
            <span className="text-[12.5px] text-text-muted">
              Continue on error
              <span className="mt-0.5 block text-[11px] text-text-subtle">
                A failure here will not fail the run
              </span>
            </span>
            <Switch
              checked={sim.continueOnError}
              onCheckedChange={(continueOnError) => patchSim({ continueOnError })}
            />
          </label>
        </div>
      </div>
    </aside>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-text-subtle">{hint}</p>}
    </div>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[11px] text-text-muted tabular">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={([next]) => onChange(next ?? value)}
      />
    </div>
  );
}

/** Free-text JSON with inline validation, so a typo cannot corrupt the definition. */
function JsonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  return (
    <>
      <Textarea
        id={id}
        rows={4}
        className="font-mono text-[11.5px]"
        defaultValue={JSON.stringify(value, null, 2)}
        onBlur={(event) => {
          try {
            const parsed = JSON.parse(event.target.value || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              onChange(parsed as Record<string, unknown>);
              event.target.setAttribute('aria-invalid', 'false');
            }
          } catch {
            event.target.setAttribute('aria-invalid', 'true');
          }
        }}
      />
      <p className="mt-1 hidden text-[11px] text-danger [textarea[aria-invalid='true']+&]:block">
        Not valid JSON
      </p>
    </>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}
