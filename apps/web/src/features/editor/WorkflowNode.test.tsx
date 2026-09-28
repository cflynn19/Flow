import { ReactFlowProvider } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowNode, type WorkflowNodeType } from './WorkflowNode';
import type { NodeActivation } from '@/features/execution/execution-state';
import { defaultConfigFor } from '@flow/shared';

function renderNode(data: Partial<WorkflowNodeType['data']> = {}, type: WorkflowNodeType['type'] = 'action') {
  const props = {
    id: 'n1',
    type,
    data: { label: 'Send Email', config: defaultConfigFor(type), ...data },
    selected: false,
    isConnectable: true,
    zIndex: 1,
    xPos: 0,
    yPos: 0,
    dragging: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    deletable: true,
    selectable: true,
    draggable: true,
  } as unknown as Parameters<typeof WorkflowNode>[0];

  return render(
    <ReactFlowProvider>
      <WorkflowNode {...props} />
    </ReactFlowProvider>,
  );
}

function activation(overrides: Partial<NodeActivation> = {}): NodeActivation {
  return {
    id: 'ne-1',
    nodeId: 'n1',
    label: 'Send Email',
    kind: 'action',
    status: 'running',
    attempt: 1,
    maxAttempts: 3,
    attempts: [],
    startedAt: '2026-01-01T10:00:00.000Z',
    completedAt: null,
    durationMs: null,
    input: null,
    output: null,
    error: null,
    branch: null,
    branchDepth: 0,
    activationIndex: 0,
    skipReason: null,
    ...overrides,
  };
}

describe('WorkflowNode', () => {
  it('renders the label and its node kind', () => {
    renderNode();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('shows no run state in the editor', () => {
    renderNode();
    expect(screen.getByTestId('node-action')).toHaveAttribute('data-status', 'idle');
  });

  it('reflects each execution status', () => {
    for (const status of ['running', 'success', 'failed', 'skipped'] as const) {
      const { unmount } = renderNode({ run: activation({ status }) });
      expect(screen.getByTestId('node-action')).toHaveAttribute('data-status', status);
      unmount();
    }
  });

  it('surfaces the attempt count while a node is retrying', () => {
    renderNode({ run: activation({ status: 'retrying', attempt: 2, durationMs: 504 }) });
    expect(screen.getByText('2/3 attempts')).toBeInTheDocument();
    expect(screen.getByText('504ms')).toBeInTheDocument();
  });

  it('marks a node that ran more than once', () => {
    renderNode({ run: activation({ status: 'success', durationMs: 120 }), runCount: 4 });
    expect(screen.getByText('×4')).toBeInTheDocument();
  });

  it('gives a conditional two named branch handles', () => {
    const { container } = renderNode({ label: 'Approved?' }, 'conditional');
    const handles = container.querySelectorAll('.react-flow__handle-right');
    expect(handles).toHaveLength(2);
  });

  it('gives an end node no source handle', () => {
    const { container } = renderNode({ label: 'End' }, 'end');
    expect(container.querySelectorAll('.react-flow__handle-right')).toHaveLength(0);
    expect(container.querySelectorAll('.react-flow__handle-left')).toHaveLength(1);
  });
});
