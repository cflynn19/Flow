import type { NodeKind, WorkflowDefinition } from '@flow/shared';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import { ArrowLeft, History, Play, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from '@/components/Kbd';
import { ApiRequestError } from '@/lib/api';
import { MOD_KEY, useHotkey } from '@/lib/hotkeys';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useRunWorkflow, useUpdateWorkflow, useWorkflow } from '@/lib/queries';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NodePalette } from './NodePalette';
import { nodeTypes, type WorkflowNodeType } from './WorkflowNode';
import {
  createNode,
  definitionsEqual,
  edgeId,
  nextFreePosition,
  toCanvasEdges,
  toCanvasNodes,
  toDefinition,
} from './graph';

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  );
}

function EditorCanvas() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { data: workflow, isLoading, error, refetch } = useWorkflow(workflowId);
  const updateWorkflow = useUpdateWorkflow(workflowId ?? '');
  const runWorkflow = useRunWorkflow();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ definition: WorkflowDefinition; name: string } | null>(null);

  useEffect(() => {
    if (!workflow) return;
    setNodes(toCanvasNodes(workflow.definition));
    setEdges(toCanvasEdges(workflow.definition));
    setName(workflow.name);
    setSaved({ definition: workflow.definition, name: workflow.name });
  }, [workflow, setNodes, setEdges]);

  const definition = useMemo(() => toDefinition(nodes, edges), [nodes, edges]);
  const isDirty =
    saved !== null && (!definitionsEqual(definition, saved.definition) || name !== saved.name);

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const inboundCount = useMemo(
    () => (selected ? edges.filter((edge) => edge.target === selected.id).length : 0),
    [edges, selected],
  );

  /**
   * A node cannot feed itself: with the default "wait for all branches" join it could
   * never become ready, and the run would end in a deadlock. Refusing the connection is
   * better than letting someone save a graph that cannot run.
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => connection.source !== connection.target,
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: edgeId(connection.source, connection.target, connection.sourceHandle),
            type: 'smoothstep',
            ...(connection.sourceHandle ? { label: connection.sourceHandle } : {}),
            labelStyle: { fill: 'var(--color-text-subtle)', fontSize: 10 },
            labelBgStyle: { fill: 'var(--color-surface)' },
            labelBgPadding: [4, 2] as [number, number],
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (kind: NodeKind, position?: { x: number; y: number }) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const viewportCentre = screenToFlowPosition({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2 - 94,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2 - 28,
      });

      let created: WorkflowNodeType | null = null;
      setNodes((current) => {
        const point = position ?? nextFreePosition(current, viewportCentre);
        created = createNode(kind, point);
        return [...current, created];
      });

      if (created) setSelectedId((created as WorkflowNodeType).id);

      // Selecting the node opens the config panel, which narrows the canvas. Fit only
      // after that relayout has happened, or the new node ends up behind the panel.
      if (!position) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => void fitView({ padding: 0.24, duration: 240 })),
        );
      }
    },
    [screenToFlowPosition, setNodes, fitView],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedId(null);
    },
    [setNodes, setEdges],
  );

  const save = useCallback(async () => {
    if (!workflowId || !isDirty) return;
    try {
      const result = await updateWorkflow.mutateAsync({ name, definition });
      setSaved({ definition: result.definition, name: result.name });
      toast.success('Workflow saved');
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not save the workflow',
      );
    }
  }, [workflowId, isDirty, updateWorkflow, name, definition]);

  const run = useCallback(async () => {
    if (!workflowId) return;
    try {
      // Saving first means the run always reflects what is on screen.
      if (isDirty) {
        const result = await updateWorkflow.mutateAsync({ name, definition });
        setSaved({ definition: result.definition, name: result.name });
      }
      const execution = await runWorkflow.mutateAsync({ id: workflowId });
      navigate(`/app/workflows/${workflowId}/runs/${execution.id}`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not start the run');
    }
  }, [workflowId, isDirty, updateWorkflow, name, definition, runWorkflow, navigate]);

  useHotkey('mod+s', (event) => {
    event.preventDefault();
    void save();
  }, { allowInInputs: true });
  useHotkey('r', () => void run());
  useHotkey('escape', () => setSelectedId(null));
  useHotkey('backspace', () => selectedId && deleteNode(selectedId));
  useHotkey('delete', () => selectedId && deleteNode(selectedId));

  useUnsavedChanges(
    isDirty,
    'This workflow has unsaved changes. Leave and discard them?',
  );

  if (isLoading) return <LoadingState label="Loading workflow" />;
  if (error || !workflow) {
    return (
      <div className="p-6">
        <ErrorState
          title="Could not load this workflow"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/app/workflows" aria-label="Back to workflows">
            <ArrowLeft />
          </Link>
        </Button>

        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Workflow name"
          className="h-7 max-w-72 border-transparent bg-transparent px-1.5 text-[13px] font-medium hover:border-border"
        />

        {isDirty && (
          <span className="flex items-center gap-1.5 text-[11px] text-warning">
            <span className="size-1.5 rounded-full bg-warning" />
            Unsaved
          </span>
        )}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" asChild>
          <Link to={`/app/executions?workflowId=${workflowId}`}>
            <History />
            History
          </Link>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void save()}
              disabled={!isDirty || updateWorkflow.isPending}
            >
              <Save />
              Save
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            Save <Kbd>{`${MOD_KEY}S`}</Kbd>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void run()}
              disabled={runWorkflow.isPending || nodes.length === 0}
            >
              <Play />
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            Run workflow <Kbd>R</Kbd>
          </TooltipContent>
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodePalette onAdd={addNode} />

        <div ref={wrapperRef} className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const kind = event.dataTransfer.getData('application/flow-node') as NodeKind;
              if (!kind) return;
              addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
            fitView
            fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            className="bg-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1d1d23" />
            <Controls showInteractive={false} className="!shadow-none" />
            <MiniMap
              pannable
              zoomable
              nodeColor="#2c2c34"
              maskColor="rgba(8,8,10,0.72)"
              className="!bottom-3 !right-3"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm rounded-lg border border-dashed border-border bg-surface/80 px-6 py-8 text-center backdrop-blur-sm">
                <p className="text-[13px] font-medium text-text">This canvas is empty</p>
                <p className="mt-1 text-[13px] text-text-muted">
                  Start with a Trigger, then connect actions to it. Drag from the palette or
                  click a node type to drop one here.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => addNode('trigger')}
                >
                  Add a trigger
                </Button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <NodeConfigPanel
            node={selected}
            inboundCount={inboundCount}
            onDelete={() => deleteNode(selected.id)}
            onChange={(patch) =>
              setNodes((current) =>
                current.map((node) =>
                  node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node,
                ),
              )
            }
          />
        )}
      </div>
    </div>
  );
}
