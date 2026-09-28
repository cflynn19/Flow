import type { NodeKind } from '@flow/shared';
import {
  CircleDot,
  GitBranch,
  Octagon,
  Split,
  Timer,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Presentation metadata per node kind. This is the frontend half of the node registry --
 * the engine half lives in apps/api/src/engine/nodes. Adding a kind means adding one
 * entry here and one handler there.
 */
export interface NodeKindMeta {
  kind: NodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Accent used for the icon chip and palette swatch. */
  color: string;
  hasInput: boolean;
  hasOutput: boolean;
  /** Conditional nodes expose two named source handles instead of one. */
  branchHandles?: [string, string];
}

export const NODE_KIND_META: Record<NodeKind, NodeKindMeta> = {
  trigger: {
    kind: 'trigger',
    label: 'Trigger',
    description: 'Starts the workflow with a payload',
    icon: Zap,
    color: 'var(--color-accent)',
    hasInput: false,
    hasOutput: true,
  },
  action: {
    kind: 'action',
    label: 'Action',
    description: 'Performs an operation and returns a result',
    icon: CircleDot,
    color: '#5fb4e8',
    hasInput: true,
    hasOutput: true,
  },
  delay: {
    kind: 'delay',
    label: 'Delay',
    description: 'Waits for a fixed duration',
    icon: Timer,
    color: '#d9a441',
    hasInput: true,
    hasOutput: true,
  },
  conditional: {
    kind: 'conditional',
    label: 'Conditional',
    description: 'Branches on a condition',
    icon: GitBranch,
    color: '#c58af0',
    hasInput: true,
    hasOutput: true,
    branchHandles: ['true', 'false'],
  },
  parallel: {
    kind: 'parallel',
    label: 'Parallel',
    description: 'Fans out to concurrent branches',
    icon: Split,
    color: '#4fc4a6',
    hasInput: true,
    hasOutput: true,
  },
  end: {
    kind: 'end',
    label: 'End',
    description: 'Terminates a path',
    icon: Octagon,
    color: '#7d8590',
    hasInput: true,
    hasOutput: false,
  },
};

export const NODE_KIND_ORDER: NodeKind[] = [
  'trigger',
  'action',
  'conditional',
  'parallel',
  'delay',
  'end',
];
