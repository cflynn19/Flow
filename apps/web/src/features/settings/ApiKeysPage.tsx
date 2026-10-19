import { formatRelativeTime, type ApiKey } from '@flow/shared';
import { AlertTriangle, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { API_BASE, ApiRequestError } from '@/lib/api';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/lib/queries';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

/** Where an app sends its events. The API sits behind the same origin as this page. */
function ingestUrl() {
  return `${window.location.origin}${API_BASE}/ingest/events`;
}

/**
 * API keys let an app outside Flow report its own runs. A key is shown once, when it is
 * created -- the API keeps only a hash -- so creating one ends on a screen built around
 * copying it.
 */
export function ApiKeysPage() {
  const now = useNow();
  const { data: apiKeys, isLoading, isError, error, refetch } = useApiKeys();
  const deleteApiKey = useDeleteApiKey();
  const [creating, setCreating] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight text-text">API keys</h1>
            <p className="mt-0.5 max-w-xl text-[13px] text-text-muted">
              A key lets your own app report its runs to Flow, where they show up live like any
              other execution.
            </p>
          </div>
          {apiKeys && apiKeys.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              New key
            </Button>
          )}
        </header>

        {isLoading && <SkeletonRows rows={3} />}

        {isError && (
          <ErrorState
            title="Could not load API keys"
            message={error instanceof Error ? error.message : undefined}
            onRetry={() => void refetch()}
          />
        )}

        {apiKeys?.length === 0 && (
          <EmptyState
            icon={<KeyRound />}
            title="No API keys yet"
            description="Create a key, then send step events from your app to see its runs here."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                Create a key
              </Button>
            }
          />
        )}

        {apiKeys && apiKeys.length > 0 && (
          <ul aria-label="API keys" className="overflow-hidden rounded-lg border border-border bg-surface">
            {apiKeys.map((apiKey) => (
              <li
                key={apiKey.id}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
              >
                <KeyRound className="size-4 shrink-0 text-text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-text">{apiKey.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-subtle">
                    {apiKey.prefix}… · created {formatRelativeTime(apiKey.createdAt, now)} ·{' '}
                    {apiKey.lastUsedAt
                      ? `last used ${formatRelativeTime(apiKey.lastUsedAt, now)}`
                      : 'never used'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingRevoke(apiKey)}
                  aria-label={`Revoke ${apiKey.name}`}
                >
                  <Trash2 />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {apiKeys && apiKeys.length > 0 && (
          <section className="mt-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-[13px] font-medium text-text">Sending events</h2>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Send batches of events with <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
              The README’s “Reporting runs from your own app” section lists the event types.
            </p>
            <CopyField className="mt-3" label="Ingest endpoint" value={`POST ${ingestUrl()}`} />
          </section>
        )}
      </div>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} />

      <Dialog open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{pendingRevoke?.name}”?</DialogTitle>
            <DialogDescription>
              Anything still using this key is rejected from now on. Runs it already reported
              are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteApiKey.isPending}
              onClick={async () => {
                if (!pendingRevoke) return;
                try {
                  await deleteApiKey.mutateAsync(pendingRevoke.id);
                  toast.success(`Revoked “${pendingRevoke.name}”`);
                } catch (err) {
                  toast.error(err instanceof ApiRequestError ? err.message : 'Could not revoke');
                } finally {
                  setPendingRevoke(null);
                }
              }}
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createApiKey = useCreateApiKey();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  const close = () => {
    onOpenChange(false);
    // Drop the key from memory as soon as the dialog is gone; it is never shown again.
    setCreated(null);
    setName('');
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await createApiKey.mutateAsync({ name: name.trim() });
      setCreated({ name: result.apiKey.name, key: result.key });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? (err.fieldError('name') ?? err.message)
          : 'Could not create the key',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className={created ? 'max-w-2xl' : undefined}
        // A stray click outside must not throw away a key that cannot be shown again.
        onInteractOutside={(event) => created && event.preventDefault()}
      >
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>
                This is the only time “{created.name}” will be shown. Flow stores only a hash
                of it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-5 pb-5">
              <CopyField label="API key" value={created.key} autoFocus />
              <CopyField label="Try it" value={curlExample(created.key)} multiline />
              <p className="flex items-start gap-2 text-[12px] text-text-muted">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />
                Keep it in your app’s secrets or environment config, not in source control.
              </p>
            </div>
            <DialogFooter>
              <Button variant="primary" size="sm" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Name it after the app that will use it, so you know what to revoke later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 px-5 pb-5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                autoFocus
                value={name}
                maxLength={80}
                placeholder="e.g. Alexandria functions"
                aria-invalid={error ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={createApiKey.isPending || name.trim().length === 0}
              >
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A complete one-step run, so trying the key leaves a finished run rather than an open one. */
function curlExample(key: string) {
  const run = { runId: 'hello-1', workflow: 'Hello from curl' };
  const events = [
    { ...run, type: 'run.started' },
    { ...run, type: 'step.started', step: 'say-hello' },
    { ...run, type: 'step.completed', step: 'say-hello' },
    { ...run, type: 'run.completed' },
  ];
  return [
    `curl -X POST ${ingestUrl()} \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify({ events })}'`,
  ].join('\n');
}

function CopyField({
  label,
  value,
  multiline = false,
  autoFocus = false,
  className,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the text is still selectable by hand.
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">{label}</p>
      <div className="flex items-start gap-2 rounded-sm border border-border bg-canvas p-2">
        <pre
          className={cn(
            'min-w-0 flex-1 select-all font-mono text-[12px] leading-[1.6] text-text',
            multiline ? 'overflow-x-auto whitespace-pre' : 'break-all whitespace-pre-wrap',
          )}
        >
          {value}
        </pre>
        <Button
          variant="ghost"
          size="icon"
          autoFocus={autoFocus}
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
