import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Renders a node's input/output payload. Syntax colouring is done with a small tokeniser
 * rather than a highlighting library -- the payloads are always JSON, so the whole job is
 * four token types.
 */
function highlight(json: string) {
  const pattern = /("(?:\\.|[^"\\])*"(?:\s*:)?)|(\b-?\d+\.?\d*(?:e[+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/gi;
  const parts: { text: string; className: string }[] = [];
  let lastIndex = 0;

  for (const match of json.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: json.slice(lastIndex, index), className: 'text-text-subtle' });

    const [text, str, num, bool, nul] = match;
    if (str) {
      parts.push({
        text,
        className: text.trimEnd().endsWith(':') ? 'text-[#9aa5f2]' : 'text-[#7fc98a]',
      });
    } else if (num) parts.push({ text, className: 'text-[#d9a441]' });
    else if (bool) parts.push({ text, className: 'text-[#68b4f0]' });
    else if (nul) parts.push({ text, className: 'text-text-subtle italic' });

    lastIndex = index + text.length;
  }

  if (lastIndex < json.length) parts.push({ text: json.slice(lastIndex), className: 'text-text-subtle' });
  return parts;
}

export function JsonViewer({
  value,
  emptyLabel = 'No data',
  className,
}: {
  value: unknown;
  emptyLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) {
    return <p className={cn('font-mono text-[12px] text-text-subtle', className)}>{emptyLabel}</p>;
  }

  const json = JSON.stringify(value, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the payload is still selectable by hand.
    }
  };

  return (
    <div className={cn('group relative', className)}>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy JSON"
        className="absolute right-1.5 top-1.5 rounded-xs p-1 text-text-subtle opacity-0 transition hover:bg-surface-hover hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="max-h-72 overflow-auto rounded-sm border border-border bg-canvas p-3 font-mono text-[12px] leading-[1.6]">
        <code>
          {highlight(json).map((part, i) => (
            <span key={i} className={part.className}>
              {part.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
