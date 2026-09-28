import type { ExecutionEvent } from '@flow/shared';

type Listener = (event: ExecutionEvent) => void;

/**
 * In-process pub/sub between the engine and any open SSE connections. Events are
 * persisted before they reach here, so a subscriber that arrives late (or reconnects)
 * can replay from the database and then attach without a gap.
 */
class ExecutionBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly live = new Set<string>();

  subscribe(executionId: string, listener: Listener): () => void {
    let set = this.listeners.get(executionId);
    if (!set) {
      set = new Set();
      this.listeners.set(executionId, set);
    }
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(executionId);
    };
  }

  publish(executionId: string, event: ExecutionEvent): void {
    for (const listener of this.listeners.get(executionId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken client connection must never interrupt the run.
      }
    }
  }

  markLive(executionId: string): void {
    this.live.add(executionId);
  }

  markFinished(executionId: string): void {
    this.live.delete(executionId);
  }

  /** True while the engine is still producing events for this execution. */
  isLive(executionId: string): boolean {
    return this.live.has(executionId);
  }
}

export const executionBus = new ExecutionBus();
