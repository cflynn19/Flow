import type { ExecutionStatus, NodeStatus } from '@flow/shared';

/**
 * One vocabulary for status colour across the canvas, tables, timeline and inspector, so
 * a green ring on a node and a green row in history always mean the same thing.
 */
export type RunState = NodeStatus | 'retrying';

interface StatusStyle {
  label: string;
  /** Text colour class. */
  text: string;
  /** Background for chips and pills. */
  chip: string;
  /** Border/ring colour for canvas nodes. */
  ring: string;
  /** Solid fill for timeline bars and dots. */
  fill: string;
  glyph: string;
}

export const NODE_STATUS_STYLES: Record<RunState, StatusStyle> = {
  pending: {
    label: 'Pending',
    text: 'text-text-subtle',
    chip: 'bg-skipped-muted text-text-subtle',
    ring: 'border-border',
    fill: 'bg-[#33333b]',
    glyph: '○',
  },
  running: {
    label: 'Running',
    text: 'text-running',
    chip: 'bg-running-muted text-running',
    ring: 'border-running',
    fill: 'bg-running',
    glyph: '◐',
  },
  retrying: {
    label: 'Retrying',
    text: 'text-warning',
    chip: 'bg-warning-muted text-warning',
    ring: 'border-warning',
    fill: 'bg-warning',
    glyph: '↻',
  },
  success: {
    label: 'Success',
    text: 'text-success',
    chip: 'bg-success-muted text-success',
    ring: 'border-success',
    fill: 'bg-success',
    glyph: '✓',
  },
  failed: {
    label: 'Failed',
    text: 'text-danger',
    chip: 'bg-danger-muted text-danger',
    ring: 'border-danger',
    fill: 'bg-danger',
    glyph: '✕',
  },
  skipped: {
    label: 'Skipped',
    text: 'text-skipped',
    chip: 'bg-skipped-muted text-skipped',
    ring: 'border-border',
    fill: 'bg-skipped',
    glyph: '–',
  },
};

export const EXECUTION_STATUS_STYLES: Record<ExecutionStatus, StatusStyle> = {
  pending: NODE_STATUS_STYLES.pending,
  running: NODE_STATUS_STYLES.running,
  success: NODE_STATUS_STYLES.success,
  failed: NODE_STATUS_STYLES.failed,
  canceled: NODE_STATUS_STYLES.skipped,
};
