import {
  DEFAULT_SIMULATION,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type Simulation,
  type WorkflowDefinition,
  defaultConfigFor,
} from '@flow/shared';

/**
 * The workflows Flow ships with. They exist to make the app look and behave like a real
 * product the moment it is installed -- including runs that fail, retry and branch.
 */

interface NodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  description?: string;
  x: number;
  y: number;
  simulation?: Partial<Simulation>;
  config?: Record<string, unknown>;
}

function buildNode(spec: NodeSpec): FlowNode {
  const base = defaultConfigFor(spec.kind);
  return {
    id: spec.id,
    type: spec.kind,
    position: { x: spec.x, y: spec.y },
    data: {
      label: spec.label,
      ...(spec.description ? { description: spec.description } : {}),
      config: {
        ...base,
        ...spec.config,
        simulation: { ...DEFAULT_SIMULATION, ...base.simulation, ...spec.simulation },
      } as FlowNode['data']['config'],
    },
  };
}

function link(source: string, target: string, sourceHandle?: string, label?: string): FlowEdge {
  return {
    id: `${source}__${target}${sourceHandle ? `__${sourceHandle}` : ''}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(label ? { label } : {}),
  };
}

function build(nodes: NodeSpec[], edges: FlowEdge[]): WorkflowDefinition {
  return { nodes: nodes.map(buildNode), edges };
}

const COL = 260;
const ROW = 130;

export interface SeedWorkflow {
  name: string;
  description: string;
  definition: WorkflowDefinition;
  /** Seeds used for the demo executions, in order. Fixed so the seed data is stable. */
  runSeeds: number[];
}

const signupPipeline: SeedWorkflow = {
  name: 'Signup Pipeline',
  description: 'Registers a new account, then fans out to email and recommendations.',
  definition: build(
    [
      { id: 'signup', kind: 'trigger', label: 'User Signup', description: 'POST /signup', x: 0, y: ROW, config: { payload: { email: 'ada@example.com', plan: 'pro' } } },
      { id: 'authenticate', kind: 'action', label: 'Authenticate', x: COL, y: ROW, config: { operation: 'authenticate' }, simulation: { minDurationMs: 90, maxDurationMs: 220 } },
      { id: 'createUser', kind: 'action', label: 'Create User', x: COL * 2, y: ROW, config: { operation: 'createUser' }, simulation: { minDurationMs: 140, maxDurationMs: 340, failureProbability: 0.08, maxRetries: 2 } },
      { id: 'fanout', kind: 'parallel', label: 'Fan out', x: COL * 3, y: ROW, simulation: { minDurationMs: 0, maxDurationMs: 0 } },
      { id: 'sendEmail', kind: 'action', label: 'Send Email', description: 'Welcome email via Postmark', x: COL * 4, y: 0, config: { operation: 'sendEmail' }, simulation: { minDurationMs: 180, maxDurationMs: 520, failureProbability: 0.3, maxRetries: 2, retryBackoffMs: 120 } },
      { id: 'recommendations', kind: 'action', label: 'Generate Recommendations', x: COL * 4, y: ROW * 2, config: { operation: 'recommendations', toolCalls: 2 }, simulation: { minDurationMs: 420, maxDurationMs: 900 } },
      { id: 'end', kind: 'end', label: 'End', x: COL * 5, y: ROW, simulation: { minDurationMs: 0, maxDurationMs: 0 } },
    ],
    [
      link('signup', 'authenticate'),
      link('authenticate', 'createUser'),
      link('createUser', 'fanout'),
      link('fanout', 'sendEmail'),
      link('fanout', 'recommendations'),
      link('sendEmail', 'end'),
      link('recommendations', 'end'),
    ],
  ),
  // Chosen deliberately: four clean-or-retried runs and two that exhaust their retries,
  // so the seeded history shows real failures instead of an unbroken wall of green.
  runSeeds: [1, 5, 17, 13, 27, 43],
};

const paymentWorkflow: SeedWorkflow = {
  name: 'Payment Workflow',
  description: 'Validates and charges a card, then issues a receipt and updates the ledger.',
  definition: build(
    [
      { id: 'payment', kind: 'trigger', label: 'Payment', description: 'Checkout submitted', x: 0, y: ROW, config: { payload: { amount: 249.0, currency: 'USD', customerId: 'cus_8841' } } },
      { id: 'validate', kind: 'action', label: 'Validate', x: COL, y: ROW, config: { operation: 'validate' }, simulation: { minDurationMs: 60, maxDurationMs: 160 } },
      { id: 'fraudCheck', kind: 'conditional', label: 'Fraud Check', description: 'Route high-risk payments to review', x: COL * 2, y: ROW, config: { mode: 'probability', probability: 0.82, trueLabel: 'clear', falseLabel: 'review' }, simulation: { minDurationMs: 70, maxDurationMs: 180 } },
      { id: 'chargeCard', kind: 'action', label: 'Charge Card', x: COL * 3, y: 0, config: { operation: 'chargeCard' }, simulation: { minDurationMs: 320, maxDurationMs: 900, failureProbability: 0.4, maxRetries: 1, retryBackoffMs: 220 } },
      { id: 'manualReview', kind: 'action', label: 'Queue for Review', x: COL * 3, y: ROW * 2.2, config: { operation: 'queueReview' }, simulation: { minDurationMs: 120, maxDurationMs: 260 } },
      { id: 'receipt', kind: 'action', label: 'Send Receipt', x: COL * 4, y: -ROW * 0.6, config: { operation: 'sendReceiptEmail' }, simulation: { minDurationMs: 160, maxDurationMs: 420, failureProbability: 0.12, maxRetries: 2 } },
      { id: 'updateDb', kind: 'action', label: 'Update Ledger', x: COL * 4, y: ROW * 0.8, config: { operation: 'updateDatabase' }, simulation: { minDurationMs: 90, maxDurationMs: 260 } },
      { id: 'end', kind: 'end', label: 'End', x: COL * 5, y: ROW, simulation: { minDurationMs: 0, maxDurationMs: 0 } },
    ],
    [
      link('payment', 'validate'),
      link('validate', 'fraudCheck'),
      link('fraudCheck', 'chargeCard', 'true', 'clear'),
      link('fraudCheck', 'manualReview', 'false', 'review'),
      link('chargeCard', 'receipt'),
      link('chargeCard', 'updateDb'),
      link('receipt', 'end'),
      link('updateDb', 'end'),
      link('manualReview', 'end'),
    ],
  ),
  // Seed 3 takes the manual-review branch; 13 and 29 fail at Charge Card.
  runSeeds: [3, 1, 6, 13, 29],
};

/**
 * An agent-shaped workflow: a planner fans out to two workers, and the reviewer can send
 * the work back. The revise edge re-enters at the planner (which joins on "any"), so the
 * whole fan-out re-runs and the reviewer's join is satisfied again. That loop is why the
 * agent nodes sometimes run several times -- exactly the signal the anomaly rules catch.
 */
const agentWorkflow: SeedWorkflow = {
  name: 'Agent Workflow',
  description: 'Planner delegates to a researcher and a code agent, then a reviewer signs off.',
  definition: build(
    [
      { id: 'request', kind: 'trigger', label: 'User Request', description: '"Add OAuth to the API"', x: 0, y: ROW, config: { payload: { prompt: 'Add OAuth to the API', maxSteps: 8 } } },
      { id: 'planner', kind: 'action', label: 'Planner', description: 'Re-plans when the reviewer sends work back', x: COL, y: ROW, config: { operation: 'plan', toolCalls: 1, joinMode: 'any' }, simulation: { minDurationMs: 260, maxDurationMs: 620 } },
      { id: 'researcher', kind: 'action', label: 'Researcher', x: COL * 2, y: 0, config: { operation: 'research', toolCalls: 4 }, simulation: { minDurationMs: 380, maxDurationMs: 950, failureProbability: 0.18, maxRetries: 2, retryBackoffMs: 180 } },
      { id: 'coder', kind: 'action', label: 'Code Agent', x: COL * 2, y: ROW * 2, config: { operation: 'codeAgent', toolCalls: 3 }, simulation: { minDurationMs: 420, maxDurationMs: 1100 } },
      { id: 'reviewer', kind: 'action', label: 'Reviewer', x: COL * 3, y: ROW, config: { operation: 'review', toolCalls: 1 }, simulation: { minDurationMs: 220, maxDurationMs: 540 } },
      { id: 'verdict', kind: 'conditional', label: 'Approved?', x: COL * 4, y: ROW, config: { mode: 'probability', probability: 0.7, trueLabel: 'approved', falseLabel: 'revise' }, simulation: { minDurationMs: 40, maxDurationMs: 90 } },
      { id: 'end', kind: 'end', label: 'End', x: COL * 5, y: ROW, simulation: { minDurationMs: 0, maxDurationMs: 0 } },
    ],
    [
      link('request', 'planner'),
      link('planner', 'researcher'),
      link('planner', 'coder'),
      link('researcher', 'reviewer'),
      link('coder', 'reviewer'),
      link('reviewer', 'verdict'),
      link('verdict', 'end', 'true', 'approved'),
      link('verdict', 'planner', 'false', 'revise'),
    ],
  ),
  // 22 and 40 loop through the reviewer several times, which is what trips the
  // repeated-node-execution anomaly.
  runSeeds: [1, 22, 40, 13],
};

export const SEED_WORKFLOWS: SeedWorkflow[] = [signupPipeline, paymentWorkflow, agentWorkflow];
