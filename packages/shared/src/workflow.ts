import { z } from 'zod';

/**
 * A workflow is a directed graph of typed nodes. Everything about a node that the
 * engine needs to run it, and that the editor needs to render it, lives in this file --
 * it is the single contract shared by `@flow/api` and `@flow/web`.
 *
 * Adding a node type is four small edits:
 *   1. add the kind here + its config schema
 *   2. add a handler in apps/api/src/engine/nodes/
 *   3. add presentation metadata in apps/web/src/features/editor/node-registry.tsx
 *   4. add a config section in apps/web/src/features/editor/NodeConfigPanel.tsx
 */

export const NODE_KINDS = ['trigger', 'action', 'delay', 'conditional', 'parallel', 'end'] as const;

export const nodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof nodeKindSchema>;

/**
 * Simulated execution behaviour. For the MVP nodes do not call real services, so every
 * executable node carries the knobs that make a run interesting: how long it takes, how
 * often it fails, and how hard we retry.
 */
export const simulationSchema = z.object({
  /** Chance (0..1) that any single attempt fails. */
  failureProbability: z.number().min(0).max(1).default(0),
  minDurationMs: z.number().int().min(0).max(120_000).default(200),
  maxDurationMs: z.number().int().min(0).max(120_000).default(600),
  /** Additional attempts after the first one. 0 = no retries. */
  maxRetries: z.number().int().min(0).max(10).default(0),
  /** Delay before the first retry; grows exponentially per attempt. */
  retryBackoffMs: z.number().int().min(0).max(30_000).default(150),
  /** When true a terminal failure does not fail the whole workflow. */
  continueOnError: z.boolean().default(false),
});
export type Simulation = z.infer<typeof simulationSchema>;

export const DEFAULT_SIMULATION: Simulation = {
  failureProbability: 0,
  minDurationMs: 200,
  maxDurationMs: 600,
  maxRetries: 0,
  retryBackoffMs: 150,
  continueOnError: false,
};

/**
 * How a node with several incoming edges decides it is ready.
 *   all -- wait for every branch (the default; this is what makes a join a join)
 *   any -- fire as soon as one branch arrives, which is what makes a loop possible
 */
export const joinModeSchema = z.enum(['all', 'any']);
export type JoinMode = z.infer<typeof joinModeSchema>;

const baseConfig = z.object({
  simulation: simulationSchema.default(DEFAULT_SIMULATION),
  joinMode: joinModeSchema.default('all'),
});

export const triggerConfigSchema = baseConfig.extend({
  kind: z.literal('trigger'),
  /** Seed payload handed to the first downstream nodes. */
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const actionConfigSchema = baseConfig.extend({
  kind: z.literal('action'),
  /** Human-readable operation name, e.g. "createUser", "sendEmail". */
  operation: z.string().min(1).max(80).default('operation'),
  /**
   * Simulated tool invocations performed by this node. Recorded per execution so that
   * agent-style workflows can later be analysed for runaway tool use.
   */
  toolCalls: z.number().int().min(0).max(50).default(0),
});

export const delayConfigSchema = baseConfig.extend({
  kind: z.literal('delay'),
  durationMs: z.number().int().min(0).max(120_000).default(1000),
});

export const conditionalConfigSchema = baseConfig.extend({
  kind: z.literal('conditional'),
  /**
   * `expression` compares a field of the incoming payload; `probability` flips a
   * seeded coin. Probability mode exists so demo workflows branch believably without
   * needing real data behind them.
   */
  mode: z.enum(['expression', 'probability']).default('probability'),
  /** Dot-path into the merged input payload, e.g. "user.isPremium". */
  path: z.string().max(120).default(''),
  operator: z.enum(['eq', 'ne', 'gt', 'lt', 'exists', 'truthy']).default('truthy'),
  value: z.string().max(200).default(''),
  probability: z.number().min(0).max(1).default(0.5),
  trueLabel: z.string().max(40).default('true'),
  falseLabel: z.string().max(40).default('false'),
});

export const parallelConfigSchema = baseConfig.extend({ kind: z.literal('parallel') });

export const endConfigSchema = baseConfig.extend({ kind: z.literal('end') });

export const nodeConfigSchema = z.discriminatedUnion('kind', [
  triggerConfigSchema,
  actionConfigSchema,
  delayConfigSchema,
  conditionalConfigSchema,
  parallelConfigSchema,
  endConfigSchema,
]);
export type NodeConfig = z.infer<typeof nodeConfigSchema>;
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type ActionConfig = z.infer<typeof actionConfigSchema>;
export type DelayConfig = z.infer<typeof delayConfigSchema>;
export type ConditionalConfig = z.infer<typeof conditionalConfigSchema>;

export const nodeDataSchema = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  config: nodeConfigSchema,
});
export type FlowNodeData = z.infer<typeof nodeDataSchema>;

export const flowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: nodeKindSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  data: nodeDataSchema,
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  /** `true` / `false` for conditional branches; null/undefined otherwise. */
  sourceHandle: z.string().max(32).nullish(),
  targetHandle: z.string().max(32).nullish(),
  label: z.string().max(40).optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const workflowDefinitionSchema = z
  .object({
    nodes: z.array(flowNodeSchema).max(200),
    edges: z.array(flowEdgeSchema).max(400),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    for (const node of def.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate node id "${node.id}"`, path: ['nodes'] });
      }
      ids.add(node.id);
      if (node.type !== node.data.config.kind) {
        ctx.addIssue({
          code: 'custom',
          message: `Node "${node.id}" is a "${node.type}" but carries "${node.data.config.kind}" config`,
          path: ['nodes'],
        });
      }
    }
    for (const edge of def.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        ctx.addIssue({
          code: 'custom',
          message: `Edge "${edge.id}" references a node that does not exist`,
          path: ['edges'],
        });
      }
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

/** Nodes that only route control flow -- they never perform simulated work. */
export function isStructuralNode(kind: NodeKind): boolean {
  return kind === 'parallel' || kind === 'end';
}

export function defaultConfigFor(kind: NodeKind): NodeConfig {
  switch (kind) {
    case 'trigger':
      return triggerConfigSchema.parse({ kind });
    case 'action':
      return actionConfigSchema.parse({ kind });
    case 'delay':
      return delayConfigSchema.parse({ kind });
    case 'conditional':
      return conditionalConfigSchema.parse({ kind });
    case 'parallel':
      return parallelConfigSchema.parse({ kind });
    case 'end':
      return endConfigSchema.parse({ kind });
  }
}
