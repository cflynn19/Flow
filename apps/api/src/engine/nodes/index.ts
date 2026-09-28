import type { NodeKind } from '@flow/shared';
import type { NodeHandler } from '../types.ts';
import { actionHandler } from './action.ts';
import { conditionalHandler } from './conditional.ts';
import { delayHandler } from './delay.ts';
import { endHandler } from './end.ts';
import { parallelHandler } from './parallel.ts';
import { triggerHandler } from './trigger.ts';

const HANDLERS: NodeHandler[] = [
  triggerHandler,
  actionHandler,
  delayHandler,
  conditionalHandler,
  parallelHandler,
  endHandler,
];

const registry = new Map<NodeKind, NodeHandler>(HANDLERS.map((h) => [h.kind, h]));

/** Registering a new node kind is a one-line addition to HANDLERS above. */
export function handlerFor(kind: NodeKind): NodeHandler {
  const handler = registry.get(kind);
  if (!handler) throw new Error(`No handler registered for node kind "${kind}"`);
  return handler;
}
