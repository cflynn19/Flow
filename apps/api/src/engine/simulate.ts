import { pick, randomInt } from './rng.ts';

/**
 * Simulated nodes still need to *look* like real work in the inspector, so outputs and
 * error messages are derived from the operation name. "Send Email" failing with "SMTP
 * timeout" reads like a real incident; `{ ok: true }` everywhere does not.
 */

type Profile = {
  match: RegExp;
  output: (rng: () => number, input: Record<string, unknown>) => Record<string, unknown>;
  errors: readonly string[];
};

const hex = (rng: () => number, length: number) =>
  Array.from({ length }, () => '0123456789abcdef'[randomInt(rng, 0, 15)]).join('');

const PROFILES: Profile[] = [
  {
    match: /mail|smtp|notify|notification/i,
    output: (rng, input) => ({
      messageId: `msg_${hex(rng, 12)}`,
      to: input.email ?? 'user@example.com',
      provider: 'postmark',
      queuedAt: new Date().toISOString(),
    }),
    errors: ['SMTP timeout', 'Mail provider returned 503', 'Recipient mailbox unavailable'],
  },
  {
    match: /charge|payment|card|billing|invoice/i,
    output: (rng, input) => ({
      transactionId: `txn_${hex(rng, 10)}`,
      amount: input.amount ?? randomInt(rng, 1200, 48000) / 100,
      currency: 'USD',
      processor: 'stripe',
      captured: true,
    }),
    errors: ['Card processor declined the charge', 'Gateway timeout after 30s', 'Insufficient funds'],
  },
  {
    match: /auth|login|token|session|validate|verify/i,
    output: (rng, input) => ({
      subject: input.email ?? `user_${hex(rng, 6)}`,
      token: `tok_${hex(rng, 16)}`,
      scopes: ['read', 'write'],
      expiresIn: 3600,
    }),
    errors: ['Token signature verification failed', 'Identity provider unreachable', 'Credentials rejected'],
  },
  {
    match: /user|account|profile|signup|register/i,
    output: (rng, input) => ({
      userId: `usr_${hex(rng, 10)}`,
      email: input.email ?? `user${randomInt(rng, 100, 999)}@example.com`,
      plan: pick(rng, ['free', 'pro', 'team']),
      createdAt: new Date().toISOString(),
    }),
    errors: ['Unique constraint violation on users.email', 'Database connection reset', 'Write timeout'],
  },
  {
    match: /database|db|persist|store|write|update|record/i,
    output: (rng) => ({
      rowsAffected: randomInt(rng, 1, 4),
      table: 'accounts',
      committed: true,
      latencyMs: randomInt(rng, 3, 40),
    }),
    errors: ['Deadlock detected', 'Connection pool exhausted', 'Statement timeout'],
  },
  {
    match: /recommend|model|infer|embed|rank|predict/i,
    output: (rng) => ({
      items: Array.from({ length: randomInt(rng, 3, 6) }, () => `item_${hex(rng, 6)}`),
      model: 'ranker-v3',
      confidence: Number((0.62 + rng() * 0.36).toFixed(3)),
    }),
    errors: ['Model server returned 429', 'Inference timeout', 'Feature store unavailable'],
  },
  {
    match: /plan|planner|research|agent|review|code/i,
    output: (rng) => ({
      steps: randomInt(rng, 2, 5),
      toolCalls: randomInt(rng, 1, 4),
      summary: pick(rng, [
        'Drafted an approach and delegated two subtasks',
        'Gathered 4 sources and extracted the relevant claims',
        'Produced a patch and a short rationale',
        'Reviewed the output and requested one revision',
      ]),
      tokensUsed: randomInt(rng, 400, 4200),
    }),
    errors: ['Tool call exceeded the step budget', 'Upstream agent returned malformed JSON', 'Context window exceeded'],
  },
  {
    match: /fetch|get|read|load|lookup|query/i,
    output: (rng) => ({
      found: true,
      records: randomInt(rng, 1, 12),
      cache: pick(rng, ['hit', 'miss']),
      latencyMs: randomInt(rng, 8, 120),
    }),
    errors: ['Upstream returned 502', 'Request timed out after 5s', 'Record not found'],
  },
];

const GENERIC_ERRORS = [
  'Unexpected upstream error',
  'Operation timed out',
  'Dependency returned an invalid response',
] as const;

function profileFor(operation: string): Profile | undefined {
  return PROFILES.find((p) => p.match.test(operation));
}

export function simulateOutput(
  operation: string,
  input: unknown,
  rng: () => number,
): Record<string, unknown> {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const profile = profileFor(operation);
  const base = profile
    ? profile.output(rng, record)
    : { ok: true, operation, latencyMs: randomInt(rng, 5, 90) };
  return { operation, ...base };
}

export function simulateError(operation: string, rng: () => number): { message: string; code: string } {
  const profile = profileFor(operation);
  const message = pick(rng, profile?.errors ?? GENERIC_ERRORS);
  return { message, code: 'simulated_failure' };
}
