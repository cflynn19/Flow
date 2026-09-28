import type { ConditionalConfig } from '@flow/shared';
import type { NodeHandler } from '../types.ts';

/** Reads a dot-path out of the merged input, e.g. "user.plan". */
function resolvePath(input: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, input);
}

function compare(actual: unknown, operator: ConditionalConfig['operator'], expected: string): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'truthy':
      return Boolean(actual);
    case 'eq':
      return String(actual) === expected;
    case 'ne':
      return String(actual) !== expected;
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
  }
}

/**
 * Branches execution. The chosen handle ("true" / "false") is returned to the scheduler,
 * which satisfies the matching outgoing edges and prunes the rest.
 */
export const conditionalHandler: NodeHandler = {
  kind: 'conditional',
  execute(ctx) {
    const config = ctx.node.data.config as ConditionalConfig;

    const taken =
      config.mode === 'probability'
        ? ctx.branchRng() < config.probability
        : compare(resolvePath(ctx.input, config.path), config.operator, config.value);

    return {
      branch: taken ? 'true' : 'false',
      output: {
        ...ctx.input,
        condition: {
          mode: config.mode,
          ...(config.mode === 'expression'
            ? { path: config.path, operator: config.operator, value: config.value }
            : { probability: config.probability }),
          result: taken,
          branch: taken ? config.trueLabel : config.falseLabel,
        },
      },
    };
  },
};
