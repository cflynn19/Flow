import type { TriggerConfig } from '@flow/shared';
import type { NodeHandler } from '../types.ts';

/** Starts a workflow: merges its configured payload with the run's trigger input. */
export const triggerHandler: NodeHandler = {
  kind: 'trigger',
  duration: () => 0,
  execute(ctx) {
    const config = ctx.node.data.config as TriggerConfig;
    return { output: { ...config.payload, ...ctx.input } };
  },
};
