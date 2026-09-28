import type {
  CreateWorkflowInput,
  ExecuteWorkflowInput,
  UpdateWorkflowInput,
} from '@flow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Query keys are grouped so a mutation can invalidate exactly what it affects -- running
 * a workflow, for instance, touches the dashboard, the history list and that workflow's
 * own summary, but nothing else.
 */
export const keys = {
  me: ['me'] as const,
  stats: ['stats'] as const,
  workflows: ['workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  executions: (params: { workflowId?: string; limit?: number } = {}) =>
    ['executions', params] as const,
  execution: (id: string) => ['executions', id] as const,
  executionEvents: (id: string) => ['executions', id, 'events'] as const,
};

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => api.stats().then((r) => r.stats) });
}

export function useWorkflows() {
  return useQuery({
    queryKey: keys.workflows,
    queryFn: () => api.listWorkflows().then((r) => r.workflows),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: keys.workflow(id ?? ''),
    queryFn: () => api.getWorkflow(id!).then((r) => r.workflow),
    enabled: Boolean(id),
  });
}

export function useExecutions(params: { workflowId?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.executions(params),
    queryFn: () => api.listExecutions(params),
  });
}

export function useExecution(id: string | undefined) {
  return useQuery({
    queryKey: keys.execution(id ?? ''),
    queryFn: () => api.getExecution(id!).then((r) => r.execution),
    enabled: Boolean(id),
  });
}

export function useCreateWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) => api.createWorkflow(input).then((r) => r.workflow),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workflows });
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useUpdateWorkflow(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkflowInput) =>
      api.updateWorkflow(id, input).then((r) => r.workflow),
    onSuccess: (workflow) => {
      client.setQueryData(keys.workflow(id), workflow);
      void client.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function useDeleteWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workflows });
      void client.invalidateQueries({ queryKey: ['executions'] });
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useRunWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: ExecuteWorkflowInput }) =>
      api.executeWorkflow(id, input).then((r) => r.execution),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['executions'] });
      void client.invalidateQueries({ queryKey: keys.workflows });
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });
}
