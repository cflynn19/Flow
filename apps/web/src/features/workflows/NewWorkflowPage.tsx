import { EMPTY_DEFINITION, defaultConfigFor, type WorkflowDefinition } from '@flow/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError } from '@/lib/api';
import { useCreateWorkflow } from '@/lib/queries';

/** A new workflow starts with a trigger already placed -- an empty canvas is a dead end. */
const STARTER: WorkflowDefinition = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Start', config: defaultConfigFor('trigger') },
    },
  ],
  edges: [],
};

export function NewWorkflowPage() {
  const navigate = useNavigate();
  const createWorkflow = useCreateWorkflow();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [blank, setBlank] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const workflow = await createWorkflow.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        definition: blank ? EMPTY_DEFINITION : STARTER,
      });
      navigate(`/app/workflows/${workflow.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg px-6 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link to="/app/workflows">
            <ArrowLeft />
            Workflows
          </Link>
        </Button>

        <h1 className="text-[19px] font-semibold tracking-tight text-text">New workflow</h1>
        <p className="mt-0.5 text-[13px] text-text-muted">
          Give it a name now; you can build the graph next.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="name" className="mb-1.5 block">
              Name
            </Label>
            <Input
              id="name"
              autoFocus
              required
              value={name}
              placeholder="Signup Pipeline"
              aria-invalid={Boolean(error?.fieldError('name'))}
              onChange={(event) => setName(event.target.value)}
            />
            {error?.fieldError('name') && (
              <p className="mt-1 text-[12px] text-danger">{error.fieldError('name')}</p>
            )}
          </div>

          <div>
            <Label htmlFor="description" className="mb-1.5 block">
              Description
            </Label>
            <Textarea
              id="description"
              rows={3}
              value={description}
              placeholder="What does this workflow do?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-text-muted">
            <input
              type="checkbox"
              checked={blank}
              onChange={(event) => setBlank(event.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Start from a completely blank canvas
          </label>

          {error && !error.fieldError('name') && (
            <p className="rounded-sm border border-[#4a2523] bg-danger-muted/50 px-3 py-2 text-[12.5px] text-danger">
              {error.message}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={createWorkflow.isPending || name.trim().length === 0}
          >
            {createWorkflow.isPending ? 'Creating…' : 'Create workflow'}
          </Button>
        </form>
      </div>
    </div>
  );
}
