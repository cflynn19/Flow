import type {
  ApiError,
  CreateWorkflowInput,
  DashboardStats,
  Execution,
  ExecutionDetail,
  ExecutionEvent,
  ExecuteWorkflowInput,
  LoginInput,
  PublicUser,
  RegisterInput,
  UpdateWorkflowInput,
  Workflow,
  WorkflowSummary,
} from '@flow/shared';

export const API_BASE = '/api';

/** An error the API returned on purpose, with its code and any field-level detail. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** The message to show against a specific form field, if the API named one. */
  fieldError(path: string): string | undefined {
    return this.details?.find((d) => d.path === path)?.message;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', 'Could not reach the Flow API. Is it running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'unknown_error',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }

  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  register: (input: RegisterInput) => post<{ user: PublicUser }>('/auth/register', input),
  login: (input: LoginInput) => post<{ user: PublicUser }>('/auth/login', input),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => request<{ user: PublicUser }>('/auth/me'),

  listWorkflows: () => request<{ workflows: WorkflowSummary[] }>('/workflows'),
  getWorkflow: (id: string) => request<{ workflow: Workflow }>(`/workflows/${id}`),
  createWorkflow: (input: CreateWorkflowInput) => post<{ workflow: Workflow }>('/workflows', input),
  updateWorkflow: (id: string, input: UpdateWorkflowInput) =>
    request<{ workflow: Workflow }>(`/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteWorkflow: (id: string) => request<void>(`/workflows/${id}`, { method: 'DELETE' }),
  executeWorkflow: (id: string, input: ExecuteWorkflowInput = {}) =>
    post<{ execution: Execution }>(`/workflows/${id}/execute`, input),

  listExecutions: (params: { workflowId?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.workflowId) search.set('workflowId', params.workflowId);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return request<{ executions: Execution[]; total: number }>(
      `/executions${query ? `?${query}` : ''}`,
    );
  },
  getExecution: (id: string) => request<{ execution: ExecutionDetail }>(`/executions/${id}`),
  getExecutionEvents: (id: string) =>
    request<{ events: ExecutionEvent[] }>(`/executions/${id}/events`),

  stats: () => request<{ stats: DashboardStats }>('/stats'),
};
