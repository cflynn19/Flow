import type { NodeHandler } from '../types.ts';

/** Terminates a path. Its input becomes part of the workflow's final output. */
export const endHandler: NodeHandler = {
  kind: 'end',
  duration: () => 0,
  execute: (ctx) => ({ output: ctx.input }),
};
