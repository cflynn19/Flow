import { useEffect, useState } from 'react';

/**
 * A clock that ticks, for anything rendering "2 min ago".
 *
 * `formatRelativeTime` is computed during render, so without a tick a row keeps saying
 * "just now" until something else happens to re-render the page -- which on a quiet
 * dashboard can be never.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
