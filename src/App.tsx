import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Workflows from '@/pages/workflows';
import WorkflowQueue from '@/pages/workflow-queue';
import WorkflowDetail from '@/pages/workflow-detail';
import WorkflowBuilder from '@/pages/workflow-builder';
import ApplyWorkflow from '@/pages/apply-workflow';
import { MarketplaceProvider, useHostKey } from '@/lib/marketplace/provider';
import { ModeIndicator } from '@/components/mode-indicator';
import { WorkspaceShell } from '@/components/workspace-shell';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Workflows} />
        <Route path="/workflows/:workflowId/states/:stateId" component={WorkflowQueue} />
        <Route path="/workflows/:workflowId/apply" component={ApplyWorkflow} />
        <Route path="/workflows/:workflowId" component={WorkflowDetail} />
        <Route path="/builder" component={WorkflowBuilder} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

/**
 * Remount the ENTIRE routed tree whenever the host generation changes (demo →
 * live handoff, or a retry creating a fresh demo host). This drops all local
 * component state — workflow-builder drafts, queue selections, confirmation
 * dialogs — so nothing composed against one host can be submitted through
 * another. Query caches are isolated separately via hostKey-scoped query keys.
 */
function HostScopedRoutes() {
  const hostKey = useHostKey();
  return (
    <WouterRouter key={hostKey} base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <WorkspaceShell>
        <Router />
      </WorkspaceShell>
    </WouterRouter>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MarketplaceProvider>
          {/* No connection gate: routes render immediately with demo data
              while the Sitecore handshake (if embedded) runs in parallel. */}
          <HostScopedRoutes />
          <ModeIndicator />
        </MarketplaceProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
