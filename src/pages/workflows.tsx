import { Link, useLocation } from 'wouter';
import { useQueries } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, GitBranch, PencilRuler, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  stateIdsKey,
  useEditorUser,
  useHost,
  useHostKey,
  useStateCounts,
  useWorkflowGraph,
  useWorkflows,
} from '@/lib/marketplace/provider';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { readActionLog } from '@/lib/action-log';
import { AGING_DAYS, STALE_DAYS, type WorkflowInfo } from '@/lib/workflow/types';
import { useMemo } from 'react';

/** Aggregate live counts across every workflow for the big-number tiles. */
function useGlobalStats(workflows: WorkflowInfo[] | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  const results = useQueries({
    queries: (workflows ?? []).map((wf) => ({
      queryKey: [
        'workflow-counts',
        wf.workflowId,
        stateIdsKey(wf.states.map((s) => s.stateId)),
        hostKey,
      ],
      queryFn: () =>
        host!.getStateCounts(
          wf.workflowId,
          wf.states.map((s) => s.stateId),
        ),
      enabled: !!host,
    })),
  });
  return useMemo(() => {
    if (!workflows || workflows.length === 0) {
      return { loading: false, inFlight: 0, inReview: 0, done: 0, busiest: null as null | { state: string; workflow: string; count: number } };
    }
    const loading = results.some((r) => r.isLoading);
    let inFlight = 0;
    let inReview = 0;
    let done = 0;
    let busiest: null | { state: string; workflow: string; count: number } = null;
    workflows.forEach((wf, i) => {
      const counts = results[i]?.data;
      if (!counts) return;
      for (const state of wf.states) {
        const n = counts[state.stateId] ?? 0;
        inFlight += n;
        if (state.final) done += n;
        else inReview += n;
        if (!state.final && n > 0 && (!busiest || n > busiest.count)) {
          busiest = { state: state.displayName, workflow: wf.displayName, count: n };
        }
      }
    });
    return { loading, inFlight, inReview, done, busiest };
  }, [workflows, results]);
}

/**
 * Workflow command center — the app's home. Shows every workflow with
 * live items-per-state counts so bottlenecks are visible at a glance.
 */
export default function Workflows() {
  const user = useEditorUser();
  const workflows = useWorkflows();
  const stats = useGlobalStats(workflows.data);
  const actionLog = useMemo(() => readActionLog(), []);

  const initials = user.data?.name
    ? user.data.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title="Sitecore Workflow Operations"
        subtitle="Content review across your workflows"
        right={
          user.isLoading ? (
            <Skeleton className="size-8 rounded-full" />
          ) : user.data ? (
            <Avatar className="size-8" data-testid="avatar-editor">
              <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
          ) : null
        }
      />

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        {workflows.data && workflows.data.length > 0 && (
          <section
            className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
            aria-label="Operations overview"
            data-testid="section-stats"
          >
            <StatTile
              label="Workflows"
              value={workflows.data.length}
              loading={false}
              testId="stat-workflows"
            />
            <StatTile
              label="Items in flight"
              value={stats.inFlight}
              loading={stats.loading}
              testId="stat-in-flight"
            />
            <StatTile
              label="Awaiting review"
              value={stats.inReview}
              loading={stats.loading}
              highlight={stats.inReview > 0}
              testId="stat-in-review"
            />
            <StatTile
              label="In final states"
              value={stats.done}
              loading={stats.loading}
              testId="stat-done"
            />
            {stats.busiest && (
              <p
                className="col-span-2 text-xs text-muted-foreground sm:col-span-4"
                data-testid="text-busiest"
              >
                Busiest queue: <span className="font-medium text-foreground">{stats.busiest.state}</span>{' '}
                in {stats.busiest.workflow} with {stats.busiest.count} item
                {stats.busiest.count === 1 ? '' : 's'}.
              </p>
            )}
          </section>
        )}

        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Queue ages: <span className="font-medium">aging</span> after {AGING_DAYS} days,{' '}
            <span className="font-medium">stale</span> after {STALE_DAYS} days without an update.
          </p>
          <Button asChild variant="outline" size="sm" data-testid="link-builder">
            <Link href="/builder">
              <PencilRuler className="size-4" /> Builder
            </Link>
          </Button>
        </div>

        {workflows.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : workflows.isError ? (
          <Alert variant="danger" data-testid="alert-workflows-error">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load workflows</AlertTitle>
            <AlertDescription>
              {workflows.error instanceof Error
                ? workflows.error.message
                : 'Sitecore did not return the workflow list.'}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void workflows.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : workflows.data && workflows.data.length > 0 ? (
          <div className="space-y-3">
            {workflows.data.map((wf) => (
              <WorkflowCard key={wf.workflowId} workflow={wf} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <GitBranch className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No workflows are defined in this environment yet.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/builder">Create one in the builder</Link>
            </Button>
          </div>
        )}

        {actionLog.length > 0 && (
          <section className="mt-8" data-testid="section-action-log">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your actions this session
            </h2>
            <ul className="space-y-1.5">
              {actionLog.slice(0, 8).map((entry, i) => (
                <li
                  key={`${entry.at}-${i}`}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-xs"
                >
                  <span className="font-medium text-foreground">{entry.command}</span>{' '}
                  <span className="text-muted-foreground">
                    on {entry.itemName} — {entry.fromState}
                    {entry.toState ? ` → ${entry.toState}` : ''} ·{' '}
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  loading,
  highlight,
  testId,
}: {
  label: string;
  value: number;
  loading: boolean;
  highlight?: boolean;
  testId: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={testId}
    >
      {loading ? (
        <Skeleton className="h-9 w-14 rounded-md" />
      ) : (
        <p
          className={`text-3xl font-bold tabular-nums ${highlight ? 'text-primary' : 'text-foreground'}`}
        >
          {value}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: WorkflowInfo }) {
  const stateIds = workflow.states.map((s) => s.stateId);
  const counts = useStateCounts(workflow.workflowId, stateIds);
  const graph = useWorkflowGraph(workflow.workflowId);
  const [, navigate] = useLocation();
  const total = counts.data
    ? Object.values(counts.data).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`card-workflow-${workflow.workflowId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {workflow.displayName}
          </h2>
          <p className="text-xs text-muted-foreground">
            {workflow.states.length} states
            {total != null && ` · ${total} item${total === 1 ? '' : 's'} in flight`}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" data-testid={`link-manage-${workflow.workflowId}`}>
          <Link href={`/workflows/${encodeURIComponent(workflow.workflowId)}`}>
            <Settings2 className="size-4" /> Manage
          </Link>
        </Button>
      </div>

      {graph.data && (
        <WorkflowCanvas
          className="mt-3"
          graph={graph.data}
          countsByState={counts.data}
          onSelectState={(stateId) =>
            navigate(
              `/workflows/${encodeURIComponent(workflow.workflowId)}/states/${encodeURIComponent(stateId)}`,
            )
          }
        />
      )}

      <ul className="mt-3 space-y-1.5">
        {workflow.states.map((state) => {
          const count = counts.data?.[state.stateId];
          return (
            <li key={state.stateId}>
              <Link
                href={`/workflows/${encodeURIComponent(workflow.workflowId)}/states/${encodeURIComponent(state.stateId)}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-neutral-bg"
                data-testid={`link-state-${state.stateId}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm text-foreground">{state.displayName}</span>
                  {state.initial && (
                    <Badge colorScheme="neutral" className="shrink-0 text-[10px]">
                      initial
                    </Badge>
                  )}
                  {state.final && (
                    <Badge colorScheme="neutral" className="shrink-0 text-[10px]">
                      final
                    </Badge>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {counts.isLoading ? (
                    <Skeleton className="h-5 w-8 rounded-full" />
                  ) : (
                    <Badge
                      colorScheme={count && count > 0 && !state.final ? 'primary' : 'neutral'}
                      data-testid={`badge-count-${state.stateId}`}
                    >
                      {count ?? 0}
                    </Badge>
                  )}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {counts.isError && (
        <p className="mt-2 text-xs text-destructive">
          Counts unavailable — open a state to see its queue.
        </p>
      )}
    </section>
  );
}
