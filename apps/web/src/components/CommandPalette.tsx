import { formatRelativeTime } from '@flow/shared';
import { Command } from 'cmdk';
import { GitBranch, History, LayoutDashboard, Play, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusDot } from '@/components/StatusDot';
import { useExecutions, useRunWorkflow, useWorkflows } from '@/lib/queries';
import { useHotkey } from '@/lib/hotkeys';

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useHotkey('mod+k', (event) => {
    event.preventDefault();
    setOpen((value) => !value);
  }, { allowInInputs: true });
  return { open, setOpen };
}

/**
 * Jump to any workflow or recent run, or start a run, without leaving the keyboard.
 * Opens with ⌘K from anywhere in the app.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data: workflows = [] } = useWorkflows();
  const { data: executionsData } = useExecutions({ limit: 8 });
  const runWorkflow = useRunWorkflow();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const go = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate(path);
    },
    [navigate, onOpenChange],
  );

  const run = useCallback(
    async (workflowId: string) => {
      onOpenChange(false);
      const execution = await runWorkflow.mutateAsync({ id: workflowId });
      navigate(`/app/workflows/${workflowId}/runs/${execution.id}`);
    },
    [navigate, onOpenChange, runWorkflow],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[14vh] backdrop-blur-[2px] animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <Command
        label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface-raised shadow-[0_24px_64px_-16px_rgba(0,0,0,0.85)] animate-slide-in"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // cmdk only handles Escape for its own Dialog wrapper; this palette brings its
          // own overlay, so it has to close itself.
          if (event.key === 'Escape') {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
        loop
      >
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="Search workflows and executions…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-[14px] text-text outline-none placeholder:text-text-subtle"
        />
        <Command.List className="max-h-[22rem] overflow-y-auto p-1.5">
          <Command.Empty className="py-10 text-center text-[13px] text-text-subtle">
            Nothing matches “{search}”
          </Command.Empty>

          <Group heading="Go to">
            <Item onSelect={() => go('/app')} icon={<LayoutDashboard />}>
              Dashboard
            </Item>
            <Item onSelect={() => go('/app/workflows')} icon={<GitBranch />}>
              Workflows
            </Item>
            <Item onSelect={() => go('/app/executions')} icon={<History />}>
              Executions
            </Item>
            <Item onSelect={() => go('/app/workflows/new')} icon={<Plus />}>
              New workflow
            </Item>
          </Group>

          {workflows.length > 0 && (
            <Group heading="Workflows">
              {workflows.map((workflow) => (
                <Item
                  key={workflow.id}
                  value={`workflow ${workflow.name}`}
                  onSelect={() => go(`/app/workflows/${workflow.id}`)}
                  icon={<GitBranch />}
                  hint={`${workflow.nodeCount} nodes`}
                >
                  {workflow.name}
                </Item>
              ))}
            </Group>
          )}

          {workflows.length > 0 && (
            <Group heading="Run">
              {workflows.map((workflow) => (
                <Item
                  key={workflow.id}
                  value={`run execute ${workflow.name}`}
                  onSelect={() => void run(workflow.id)}
                  icon={<Play />}
                >
                  Run {workflow.name}
                </Item>
              ))}
            </Group>
          )}

          {executionsData && executionsData.executions.length > 0 && (
            <Group heading="Recent executions">
              {executionsData.executions.map((execution) => (
                <Item
                  key={execution.id}
                  value={`execution ${execution.seq} ${execution.workflowName}`}
                  onSelect={() =>
                    go(`/app/workflows/${execution.workflowId}/runs/${execution.id}`)
                  }
                  icon={<StatusDot status={execution.status} />}
                  hint={formatRelativeTime(execution.startedAt)}
                >
                  <span className="font-mono text-text-muted">#{execution.seq}</span>{' '}
                  {execution.workflowName}
                </Item>
              ))}
            </Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-text-subtle"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  icon,
  hint,
  value,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon?: React.ReactNode;
  hint?: string;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 text-[13px] text-text-muted data-[selected=true]:bg-surface-hover data-[selected=true]:text-text [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-text-subtle"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 font-mono text-[11px] text-text-subtle">{hint}</span>}
    </Command.Item>
  );
}
