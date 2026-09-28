import {
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type Simulation,
  type WorkflowDefinition,
  defaultConfigFor,
} from '@flow/shared';

let counter = 0;

/** Compact graph builders so a spec reads like the diagram it is testing. */
export function node(
  id: string,
  kind: NodeKind,
  overrides: { label?: string; simulation?: Partial<Simulation>; config?: Record<string, unknown> } = {},
): FlowNode {
  const config = defaultConfigFor(kind);
  const merged = {
    ...config,
    ...overrides.config,
    simulation: { ...config.simulation, ...overrides.simulation },
  } as FlowNode['data']['config'];

  counter += 1;
  return {
    id,
    type: kind,
    position: { x: counter * 160, y: 0 },
    data: { label: overrides.label ?? id, config: merged },
  };
}

export function edge(source: string, target: string, sourceHandle?: string): FlowEdge {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

export function definition(nodes: FlowNode[], edges: FlowEdge[]): WorkflowDefinition {
  return { nodes, edges };
}

/** Deterministic generator: returns the scripted values, then repeats the last one. */
export function scriptedRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

/** Durations are simulated, so tests do not need to wait them out. */
export const instantSleep = async () => {};
