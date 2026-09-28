import type { DelayConfig } from '@flow/shared';
import type { NodeHandler } from '../types.ts';

/** Waits, then passes its input through untouched. */
export const delayHandler: NodeHandler = {
  kind: 'delay',
  duration: (ctx) => (ctx.node.data.config as DelayConfig).durationMs,
  execute(ctx) {
    const config = ctx.node.data.config as DelayConfig;
    return { output: { ...ctx.input, waitedMs: config.durationMs } };
  },
};
