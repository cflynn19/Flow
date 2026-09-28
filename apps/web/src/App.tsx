import { Suspense, lazy } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/States';
import { AuthPage } from '@/features/auth/AuthPage';
import { useAuth } from '@/features/auth/AuthContext';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { LandingPage } from '@/features/landing/LandingPage';
import { NewWorkflowPage } from '@/features/workflows/NewWorkflowPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';

// React Flow is the single biggest dependency and only the canvas routes need it, so the
// landing and auth pages never pay for it.
const EditorPage = lazy(() =>
  import('@/features/editor/EditorPage').then((m) => ({ default: m.EditorPage })),
);
const ExecutionPage = lazy(() =>
  import('@/features/execution/ExecutionPage').then((m) => ({ default: m.ExecutionPage })),
);

function Canvas({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState label="Loading canvas" />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Signing you in" className="h-dvh" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="workflows/new" element={<NewWorkflowPage />} />
          <Route
            path="workflows/:workflowId"
            element={
              <Canvas>
                <EditorPage />
              </Canvas>
            }
          />
          <Route
            path="workflows/:workflowId/runs/:executionId"
            element={
              <Canvas>
                <ExecutionPage />
              </Canvas>
            }
          />
          <Route path="executions" element={<HistoryPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontSize: '13px',
          },
        }}
      />
    </TooltipProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <p className="font-mono text-[13px] text-text-subtle">404</p>
      <h1 className="text-[17px] font-semibold text-text">This page does not exist</h1>
      <a href="/app" className="text-[13px] text-accent hover:underline underline-offset-4">
        Back to the dashboard
      </a>
    </div>
  );
}
