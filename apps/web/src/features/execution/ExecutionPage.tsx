import { formatDuration, formatRelativeTime } from '@flow/shared';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react';
import { AlertTriangle, ArrowLeft, Pencil, Play, Radio } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { nodeTypes, type WorkflowNodeType } from '@/features/editor/WorkflowNode';
import { toCanvasEdges, toCanvasNodes } from '@/features/editor/graph';
import { ApiRequestError } from '@/lib/api';
import { useHotkey } from '@/lib/hotkeys';
import { useExecution, useRunWorkflow } from '@/lib/queries';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { AnomalyPanel } from './AnomalyPanel';
import { EventLog } from './EventLog';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { reduceEvents, type NodeActivation } from './execution-state';
import { useExecutionStream } from './useExecutionStream';

export function ExecutionPage() {
  return (
    <ReactFlowProvider>
      <ExecutionView />
    </ReactFlowProvider>
  );
}

function ExecutionView() {
  const now = useNow();
  const { workflowId, executionId } = useParams<{ workflowId: string; executionId: string }>();
  const navigate = useNavigate();
  const { data: execution, isLoading, error, refetch } = useExecution(executionId);
  const { state, status: streamStatus } = useExecutionStream(executionId);
  const runWorkflow = useRunWorkflow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The inspector selection belongs to one run; carrying it to the next is meaningless.
  useEffect(() => {
    setSelectedId(null);
  }, [executionId]);

  // The stream is the source of truth. The persisted record only fills in before the
  // first event lands, and after a reload of a very old run whose events were trimmed.
  const view = useMemo(() => {
    if (state.events.length > 0) return state;
    if (!execution) return state;
    return reduceEvents([]);
  }, [state, execution]);

  /*
   * A terminal status wins wherever it comes from. An execution interrupted by an API
   * restart is `failed` in the database, and before the reconciler also wrote a terminal
   * event its log simply stopped -- which left this view showing "Running" forever.
   */
  const isTerminal = (status: string | undefined) =>
    status === 'success' || status === 'failed' || status === 'canceled';

  const runStatus = isTerminal(view.status)
    ? view.status
    : isTerminal(execution?.status)
      ? execution!.status
      : state.events.length > 0
        ? view.status
        : (execution?.status ?? 'pending');
  const finalDuration =
    view.durationMs ?? (isTerminal(execution?.status) ? (execution?.durationMs ?? null) : null);
  const anomalies = state.events.length > 0 ? view.anomalies : (execution?.anomalies ?? []);
  // Workflow-level failures (interrupted, deadlocked, engine error) belong to the run
  // rather than to any one node, so nothing else on this page would ever show them.
  const runError = view.error ?? execution?.error ?? null;
  const stats = state.events.length > 0 ? view.stats : (execution?.stats ?? null);
  const isLive = runStatus === 'running';

  // While a run is in flight there is no final duration yet, so the header counts up.
  const liveStartedAt = view.startedAt ?? execution?.startedAt ?? null;
  // The ticking clock deliberately does NOT live here: state in this component
  // re-renders the whole canvas, so a 100ms tick meant re-rendering every node ten times
  // a second even when no events were arriving. <LiveDuration> owns it instead.

  const definition = execution?.definitionSnapshot;

  // Matches the engine's definition of a repeat: skipped activations do not count, so a
  // node downstream of a loop is not badged "x3" for passes where it never ran.
  const runCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const activation of view.activations) {
      if (activation.status === 'skipped') continue;
      counts[activation.nodeId] = (counts[activation.nodeId] ?? 0) + 1;
    }
    return counts;
  }, [view.activations]);

  /*
   * Node and edge objects are cached per id and only rebuilt when something that affects
   * that particular one changes.
   *
   * Rebuilding the whole array on every event gave React Flow 51 brand-new node objects
   * per event, so its memoised wrappers re-rendered all of them: ~7,500 node renders for
   * ~104 events, of which about 98% changed nothing on screen. The reducer already keeps
   * object identity for activations it did not touch, which is what makes this work.
   */
  const baseNodes = useMemo(
    () => (definition ? toCanvasNodes(definition) : []),
    [definition],
  );
  const baseEdges = useMemo(
    () => (definition ? toCanvasEdges(definition) : []),
    [definition],
  );

  const nodeCache = useRef(new Map<string, { key: readonly unknown[]; node: WorkflowNodeType }>());
  const edgeCache = useRef(new Map<string, { key: readonly unknown[]; edge: Edge }>());

  const nodes = useMemo<WorkflowNodeType[]>(() => {
    const cache = nodeCache.current;
    return baseNodes.map((base) => {
      const run = view.byNodeId[base.id];
      const runCount = runCounts[base.id];
      const selected = run?.id === selectedId;
      const key: readonly unknown[] = [base, run, runCount, selected];

      const cached = cache.get(base.id);
      if (cached && cached.key.every((value: unknown, i: number) => value === key[i])) return cached.node;

      const node: WorkflowNodeType = {
        ...base,
        selected,
        data: {
          ...base.data,
          ...(run ? { run } : {}),
          ...(runCount ? { runCount } : {}),
        },
      };
      cache.set(base.id, { key, node });
      return node;
    });
  }, [baseNodes, view.byNodeId, runCounts, selectedId]);

  const edges = useMemo<Edge[]>(() => {
    const cache = edgeCache.current;
    return baseEdges.map((base) => {
      const source = view.byNodeId[base.source];
      const target = view.byNodeId[base.target];

      // The edge shows what the run did with it: carried work, was pruned, or is live.
      let className = '';
      if (target?.status === 'running' || target?.status === 'retrying') className = 'is-active';
      else if (target?.status === 'skipped') className = 'is-pruned';
      else if (source?.status === 'success' && target && target.status !== 'pending') {
        className = 'is-done';
      }

      const key: readonly unknown[] = [base, className];
      const cached = cache.get(base.id);
      if (cached && cached.key.every((value: unknown, i: number) => value === key[i])) return cached.edge;

      const edge: Edge = { ...base, className, animated: className === 'is-active' };
      cache.set(base.id, { key, edge });
      return edge;
    });
  }, [baseEdges, view.byNodeId]);

  const selected: NodeActivation | null = selectedId
    ? (view.activations.find((a) => a.id === selectedId) ?? null)
    : null;

  const selectNode = useCallback(
    (nodeId: string) => {
      const activation = view.byNodeId[nodeId];
      setSelectedId(activation ? activation.id : null);
    },
    [view.byNodeId],
  );

  useHotkey('escape', () => setSelectedId(null));

  const rerun = useCallback(async () => {
    if (!workflowId) return;
    try {
      const next = await runWorkflow.mutateAsync({ id: workflowId });
      navigate(`/app/workflows/${workflowId}/runs/${next.id}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Could not start the run');
    }
  }, [workflowId, runWorkflow, navigate]);

  useHotkey('r', () => void rerun());

  // A finished run's persisted summary may arrive after the stream closes.
  useEffect(() => {
    if (streamStatus === 'closed' && state.events.length > 0) void refetch();
  }, [streamStatus, state.events.length, refetch]);

  if (isLoading) return <LoadingState label="Loading execution" />;
  if (error || !execution) {
    return (
      <div className="p-6">
        <ErrorState
          title="Could not load this execution"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/app/executions?workflowId=${workflowId}`} aria-label="Back to executions">
            <ArrowLeft />
          </Link>
        </Button>

        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[13px] font-medium text-text">#{execution.seq}</span>
          <span className="truncate text-[13px] text-text-muted">{execution.workflowName}</span>
        </div>

        <StatusPill status={runStatus} />

        {isLive && streamStatus === 'live' && (
          <span className="flex items-center gap-1.5 text-[11px] text-running">
            <Radio className="size-3 animate-pulse-ring" />
            Live
          </span>
        )}
        {streamStatus === 'reconnecting' && (
          <span className="flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="size-3 animate-pulse-ring" />
            Reconnecting…
          </span>
        )}
        {streamStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="size-3" />
            Stream disconnected
          </span>
        )}

        <span className="font-mono text-[12px] text-text-subtle tabular">
          {finalDuration !== null ? (
            formatDuration(finalDuration)
          ) : (
            <LiveDuration startedAt={isLive ? liveStartedAt : null} />
          )}
        </span>
        <span className="hidden text-[12px] text-text-subtle sm:inline">
          {formatRelativeTime(execution.startedAt, now)}
        </span>

        <div className="flex-1" />

        {anomalies.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-xs bg-warning-muted px-1.5 py-0.5 text-[11px] font-medium text-warning">
            <AlertTriangle className="size-3" />
            {anomalies.length} {anomalies.length === 1 ? 'anomaly' : 'anomalies'}
          </span>
        )}

        <Button variant="ghost" size="sm" asChild>
          <Link to={`/app/workflows/${workflowId}`}>
            <Pencil />
            Edit
          </Link>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void rerun()} disabled={runWorkflow.isPending}>
          <Play />
          Run again
        </Button>
      </header>

      {runStatus === 'failed' && runError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-[#4a2523] bg-danger-muted/40 px-4 py-2">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 font-mono text-[12px] leading-relaxed text-danger">
            {runError.message}
          </p>
          {runError.code && (
            <span className="shrink-0 font-mono text-[11px] text-text-subtle">{runError.code}</span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-[3]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => selectNode(node.id)}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              fitView
              fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
              className="bg-canvas"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1d1d23" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <Tabs
            defaultValue="timeline"
            className="flex min-h-0 flex-[2] flex-col border-t border-border bg-surface"
          >
            <div className="flex shrink-0 items-center gap-4 px-4 pt-2.5">
              <TabsList className="flex-1">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="events">
                  Events
                  <span className="ml-1.5 font-mono text-[11px] text-text-subtle">
                    {view.events.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="anomalies">
                  Anomalies
                  {anomalies.length > 0 && (
                    <span className="ml-1.5 font-mono text-[11px] text-warning">
                      {anomalies.length}
                    </span>
                  )}
                </TabsTrigger>
                <div className="flex-1" />
                {stats && <RunStats stats={stats} />}
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <TabsContent value="timeline">
                <Timeline
                  activations={view.activations}
                  startedAt={view.startedAt ?? execution.startedAt}
                  durationMs={finalDuration}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </TabsContent>
              <TabsContent value="events">
                <EventLog events={view.events} />
              </TabsContent>
              <TabsContent value="anomalies">
                <AnomalyPanel anomalies={anomalies} onSelectNode={selectNode} />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {selected && <Inspector activation={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

/**
 * Renders the elapsed time of an in-flight run, and owns the interval that drives it.
 *
 * Keeping this in its own component is the point: the state that ticks every 100ms then
 * re-renders one `<span>` instead of the entire execution view.
 */
function LiveDuration({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }

    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Date.now() - start));
    tick();

    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return <>{formatDuration(elapsed)}</>;
}

function RunStats({ stats }: { stats: NonNullable<ReturnType<typeof useExecution>['data']>['stats'] }) {
  if (!stats) return null;
  const items = [
    { label: 'nodes', value: stats.nodeExecutionCount },
    { label: 'retries', value: stats.totalRetries, warn: stats.totalRetries > 0 },
    { label: 'skipped', value: stats.skippedCount, warn: stats.skippedCount > 0 },
    { label: 'peak parallel', value: stats.peakParallelism },
    { label: 'tool calls', value: stats.toolCalls },
  ];

  return (
    <dl className="hidden items-center gap-4 pb-2 font-mono text-[11px] lg:flex">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-text-subtle">{item.label}</dt>
          <dd className={cn('tabular', item.warn ? 'text-warning' : 'text-text-muted')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
