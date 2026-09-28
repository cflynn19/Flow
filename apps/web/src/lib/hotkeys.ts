import { useEffect } from 'react';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

export interface HotkeyOptions {
  /** Allow the shortcut while a text field has focus. Off by default. */
  allowInInputs?: boolean;
  enabled?: boolean;
}

/**
 * Binds a single keyboard shortcut. `combo` is written as "mod+k", "shift+?" or "r",
 * where `mod` is Cmd on macOS and Ctrl elsewhere.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  { allowInInputs = false, enabled = true }: HotkeyOptions = {},
) {
  useEffect(() => {
    if (!enabled) return;

    const parts = combo.toLowerCase().split('+');
    const key = parts.at(-1) ?? '';
    const needsMod = parts.includes('mod');
    const needsShift = parts.includes('shift');
    const needsAlt = parts.includes('alt');

    const onKeyDown = (event: KeyboardEvent) => {
      if (!allowInInputs && isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== key) return;

      const mod = event.metaKey || event.ctrlKey;
      if (needsMod !== mod) return;
      if (needsShift !== event.shiftKey) return;
      if (needsAlt !== event.altKey) return;

      handler(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, handler, allowInInputs, enabled]);
}

/** Cmd on macOS, Ctrl everywhere else -- used to label shortcuts accurately. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
