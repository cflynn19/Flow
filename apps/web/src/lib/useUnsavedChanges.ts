import { useEffect } from 'react';

/**
 * Warns before abandoning unsaved work.
 *
 * `useBlocker` needs a data router and the app uses `<BrowserRouter>`, so in-app
 * navigation is intercepted at the anchor during the capture phase instead. The
 * `beforeunload` handler covers reloads and closing the tab.
 */
export function useUnsavedChanges(isDirty: boolean, message: string) {
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    const onClick = (event: MouseEvent) => {
      // Leave modified clicks alone -- those open a new tab and lose nothing.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;

      const destination = new URL(anchor.href, window.location.origin);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [isDirty, message]);
}
