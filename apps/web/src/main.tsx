import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthContext';
import { ApiRequestError } from './lib/api';
import './index.css';

/**
 * A 401 from any request means the session is gone -- signed out in another tab, expired,
 * or revoked. Clearing the cached user lets <RequireAuth> redirect, instead of leaving the
 * page showing a stale username above an "Authentication required" error.
 */
function handleUnauthorized(error: unknown) {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return;
  if (queryClient.getQueryData(['me']) === null) return;
  queryClient.setQueryData(['me'], null);
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Auth and validation failures will not fix themselves.
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
