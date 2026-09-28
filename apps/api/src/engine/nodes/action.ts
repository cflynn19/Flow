import type { ActionConfig } from '@flow/shared';
import { simulateError, simulateOutput } from '../simulate.ts';
import type { NodeHandler } from '../types.ts';

/**
 * The workhorse node. Real side effects would slot in here -- for the MVP the output and
 * any error are synthesised from the operation name so runs read like real incidents.
 */
export const actionHandler: NodeHandler = {
  kind: 'action',
  failure(ctx) {
    const config = ctx.node.data.config as ActionConfig;
    return simulateError(config.operation || ctx.node.data.label, ctx.rng);
  },
  execute(ctx) {
    const config = ctx.node.data.config as ActionConfig;
    const operation = config.operation || ctx.node.data.label;
    return {
      output: { ...ctx.input, ...simulateOutput(operation, ctx.input, ctx.rng) },
      toolCalls: config.toolCalls,
    };
  },
};
