import type { NodeHandler } from '../types.ts';

/**
 * A marker for an intentional fan-out. It does no work of its own -- the scheduler
 * already runs every satisfied outgoing edge concurrently -- but having it on the canvas
 * makes the author's intent explicit and gives the timeline a clean split point.
 */
export const parallelHandler: NodeHandler = {
  kind: 'parallel',
  duration: () => 0,
  execute: (ctx) => ({ output: ctx.input }),
};
