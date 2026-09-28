import type { ExecutionEvent } from '@flow/shared';
import { useEffect, useReducer, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import {
  executionReducer,
  initialExecutionState,
  type ExecutionViewState,
} from './execution-state';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

/**
 * How long the stream may stay silent before we stop calling it live. The server pings
 * every 5s, so three missed beats means the connection is dead even if the socket is
 * still nominally open -- which is what happens when the API is killed behind a proxy
 * that holds the client connection.
 */
const STALE_AFTER_MS = 16_000;

/** Delay before rebuilding a stream that failed. Replay makes reconnecting idempotent. */
const RETRY_AFTER_MS = 3_000;

/**
 * Subscribes to an execution's event stream and folds it into view state.
 *
 * `EventSource` does the reconnect handling for us: the browser resends the last event id
 * it saw, and the server replays from there. Because every event is persisted before it
 * is broadcast, a dropped connection costs nothing -- which is why this is SSE and not a
 * WebSocket.
 */
export function useExecutionStream(executionId: string | undefined, enabled = true) {
  const [state, dispatch] = useReducer(executionReducer, initialExecutionState);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const sourceRef = useRef<EventSource | null>(null);
  // Kept in a ref so reconnecting does not re-run this effect on every event.
  const lastSeqRef = useRef(0);
  const currentIdRef = useRef<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!executionId || !enabled) {
      setStatus('closed');
      return;
    }

    /*
     * "Run again" keeps the same route, so this component is never remounted -- only the
     * id changes. Without an explicit reset the previous run's events stay in state and
     * its last sequence number is sent as `since`, so the new run's early events are
     * dropped by both the server and the reducer and the page keeps showing the old run.
     */
    const isNewExecution = currentIdRef.current !== executionId;
    if (isNewExecution) {
      currentIdRef.current = executionId;
      lastSeqRef.current = 0;
      dispatch({ type: 'reset' });
    }

    setStatus(isNewExecution || attempt === 0 ? 'connecting' : 'reconnecting');
    const source = new EventSource(
      `${API_BASE}/executions/${executionId}/stream?since=${lastSeqRef.current}`,
      { withCredentials: true },
    );
    sourceRef.current = source;

    let staleTimer: number | undefined;
    let retryTimer: number | undefined;
    let done = false;

    /** Rebuild the stream. The server replays from `since`, so nothing is missed. */
    const scheduleRetry = () => {
      if (done || retryTimer !== undefined) return;
      setStatus('reconnecting');
      retryTimer = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_AFTER_MS);
    };

    const markAlive = () => {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(scheduleRetry, STALE_AFTER_MS);
    };

    const handle = (raw: MessageEvent<string>) => {
      try {
        const event = JSON.parse(raw.data) as ExecutionEvent;
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
        dispatch(event);
        markAlive();
        setStatus('live');
        if (event.type === 'workflow.completed' || event.type === 'workflow.failed') {
          done = true;
          window.clearTimeout(staleTimer);
          window.clearTimeout(retryTimer);
          source.close();
          setStatus('closed');
        }
      } catch {
        // A malformed frame should not tear down a run that is otherwise fine.
      }
    };

    source.onopen = () => {
      markAlive();
      setStatus('live');
    };

    // The heartbeat carries no state; it exists purely to prove the stream is alive.
    source.addEventListener('ping', () => {
      markAlive();
      setStatus((current) => (current === 'closed' ? current : 'live'));
    });
    source.onmessage = handle;
    // The server names each event, so subscribe to the named types too.
    for (const type of [
      'workflow.started',
      'node.started',
      'node.completed',
      'node.failed',
      'node.retrying',
      'node.skipped',
      'workflow.completed',
      'workflow.failed',
    ]) {
      source.addEventListener(type, handle as EventListener);
    }

    source.onerror = () => {
      if (done) return;
      // A non-200 response (the proxy's 502 while the API is down) fails an EventSource
      // permanently, so recovery has to be driven here rather than left to the browser.
      if (source.readyState === EventSource.CLOSED) scheduleRetry();
      else setStatus('reconnecting');
    };

    return () => {
      done = true;
      window.clearTimeout(staleTimer);
      window.clearTimeout(retryTimer);
      source.close();
      sourceRef.current = null;
    };
  }, [executionId, enabled, attempt]);

  return { state, status } as { state: ExecutionViewState; status: StreamStatus };
}
