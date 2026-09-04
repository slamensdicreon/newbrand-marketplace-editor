import { useMemo, useState } from 'react';
import { BrandReviewPanel } from '@/components/brand-review';
import type { BrandReviewResult } from '@/lib/workflow/brand-review';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowUpRight,
  Clock,
  FileText,
  GitBranch,
  History,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  getActiveHostKey,
  useHost,
  useHostKey,
  useItemHistory,
  useItemWorkflowStatus,
  usePageContentUpdates,
  usePageContext,
  useStateCommands,
  useWorkflowGraph,
  useMarketplace,
  type ItemWorkflowStatus,
} from '@/lib/marketplace/provider';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';
import { appendActionLog } from '@/lib/action-log';
import {
  ageBucket,
  formatAge,
  type WorkflowCommandInfo,
} from '@/lib/workflow/types';

/**
 * Compact workflow companion rendered inside the SitecoreAI Page builder
 * context panel (route: /panel). It resolves the page the editor is looking
 * at via the Marketplace page context, shows that page's workflow placement,
 * age, permitted commands and recent history, and runs commands through the
 * same guarded flow as the full app: fresh re-resolution → impact review →
 * explicit confirmation → cache refresh. It never edits page content.
 */
/**
 * Mutable module-level token identifying the page the panel currently shows
 * (host generation + item + language). A guarded mutation captures it when
 * confirmation starts and re-checks it immediately before the write, so a
 * command confirmed for one page can never execute after the editor
 * navigated to another — even though the in-flight mutation outlives the
 * unmounted component.
 */
const currentPanelPage = { token: '' };
function pageToken(hostKey: string, itemId: string, language: string): string {
  return `${hostKey}|${itemId}::${language}`;
}

export default function PagePanel() {
  const { page, ready } = usePageContext();
  const hostKey = useHostKey();
  currentPanelPage.token = ready && page ? pageToken(hostKey, page.itemId, page.language) : '';

  return (
    <div className="min-h-full w-full bg-background p-3" data-testid="page-panel">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <GitBranch className="size-4 text-primary" /> Workflow
        </h1>
        <DemoPageSwitcher />
      </header>

      {!ready ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : !page ? (
        <div
          className="rounded-lg border border-dashed border-border p-4 text-center"
          data-testid="text-no-page"
        >
          <FileText className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">
            Open a page in the Page builder to see its workflow here.
          </p>
        </div>
      ) : (
        <PageStatus
          key={`${page.itemId}::${page.language}`}
          itemId={page.itemId}
          language={page.language}
          fallbackName={page.name}
          fallbackPath={page.path}
        />
      )}
    </div>
  );
}

/** Demo-mode only: simulate Page builder navigation between demo pages. */
function DemoPageSwitcher() {
  const host = useHost();
  const { status } = useMarketplace();
  const [, force] = useState(0);
  if (status.state === 'live' || !(host instanceof MockMarketplaceHost)) return null;
  const pages = host.listDemoPages();
  if (pages.length < 2) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs"
      onClick={() => {
        host.navigateDemoPage(host.currentDemoPageIndex + 1);
        force((n) => n + 1);
      }}
      data-testid="button-demo-next-page"
    >
      <RefreshCw className="size-3" /> Next demo page
    </Button>
  );
}

function PageStatus({
  itemId,
  language,
  fallbackName,
  fallbackPath,
}: {
  itemId: string;
  language: string;
  fallbackName: string;
  fallbackPath: string;
}) {
  const status = useItemWorkflowStatus(itemId, language);
  usePageContentUpdates(itemId);
  // Latest advisory AI quality check for this page. Purely informational:
  // results never trigger, block, or modify workflow commands. Staleness is
  // judged against the page's CURRENT __Updated value, which is refreshed by
  // usePageContentUpdates whenever the Page builder reports a fields/layout
  // save — so a review is flagged immediately when the page changes.
  const [review, setReview] = useState<BrandReviewResult | null>(null);
  const handleReview = (result: BrandReviewResult) => {
    setReview(result);
    // Re-resolve the page's updated timestamp so a just-generated review is
    // compared against equally fresh page state.
    void status.refetch();
  };

  if (status.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <Alert variant="danger" data-testid="alert-status-error">
        <AlertCircle className="size-4" />
        <AlertTitle>Could not read this page&apos;s workflow</AlertTitle>
        <AlertDescription>
          {status.error instanceof Error ? status.error.message : 'Unknown error.'}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void status.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const data = status.data;
  const workflow = data?.workflow ?? null;
  const state = data?.state ?? null;
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="truncate text-sm font-semibold text-foreground" data-testid="text-page-name">
          {data?.name ?? fallbackName}
        </h2>
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={data?.path ?? fallbackPath}
        >
          {data?.path ?? fallbackPath}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {language}
          {data?.version != null ? ` · v${data.version}` : ''}
        </p>
      </section>

      <BrandReviewPanel
        itemId={itemId}
        language={language}
        itemUpdatedAt={data?.updatedAt ?? null}
        review={review}
        onReview={handleReview}
      />

      {!data || !workflow || !state ? (
        <div
          className="rounded-lg border border-dashed border-border p-3 text-center"
          data-testid="text-no-workflow"
        >
          <p className="text-xs text-muted-foreground">
            This page is not in a workflow. Assign one from{' '}
            <FullAppLink href="workflows" label="WorkFLO" inline />.
          </p>
        </div>
      ) : (
        <WorkflowSection
          status={{ ...data, workflow, state }}
          onRefresh={() => void status.refetch()}
        />
      )}
    </div>
  );
}

function WorkflowSection({
  status,
  onRefresh,
}: {
  status: ItemWorkflowStatus & {
    workflow: NonNullable<ItemWorkflowStatus['workflow']>;
    state: NonNullable<ItemWorkflowStatus['state']>;
  };
  onRefresh: () => void;
}) {
  const commands = useStateCommands(status.workflow.workflowId, status.state.stateId);
  const graph = useWorkflowGraph(status.workflow.workflowId);
  const history = useItemHistory(status.workflow.workflowId, status.itemId, status.language);
  const bucket = ageBucket(status.updatedAt);
  const recentHistory = useMemo(
    () => (history.data ? [...history.data].reverse().slice(0, 3) : []),
    [history.data],
  );

  const queueHref = `workflows/${encodeURIComponent(status.workflow.workflowId)}/states/${encodeURIComponent(status.state.stateId)}`;

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-foreground" data-testid="text-workflow-name">
            {status.workflow.displayName}
          </p>
          {status.updatedAt && (
            <Badge
              colorScheme={bucket === 'stale' ? 'danger' : bucket === 'aging' ? 'warning' : 'neutral'}
              className="shrink-0"
              data-testid="badge-page-age"
            >
              <Clock className="size-3" /> {formatAge(status.updatedAt)}
            </Badge>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Badge
            colorScheme={status.state.final ? 'success' : 'neutral'}
            data-testid="badge-page-state"
          >
            {status.state.displayName}
          </Badge>
          {status.state.final && (
            <span className="text-[11px] text-muted-foreground">final state</span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {commands.isLoading ? (
            <Skeleton className="h-7 w-20 rounded-md" />
          ) : (commands.data ?? []).length > 0 ? (
            (commands.data ?? []).map((command) => (
              <CommandButton
                key={command.commandId}
                status={status}
                command={command}
                targetStateName={
                  graph.data?.states.find(
                    (s) =>
                      s.stateId ===
                      graph.data?.transitions.find((t) => t.commandId === command.commandId)
                        ?.toStateId,
                  )?.displayName ?? null
                }
                onDone={onRefresh}
              />
            ))
          ) : (
            <span className="text-[11px] text-muted-foreground" data-testid="text-no-commands">
              No actions are available from {status.state.displayName}.
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="size-3" /> Recent history
        </h3>
        {history.isLoading ? (
          <Skeleton className="mt-2 h-8 w-full" />
        ) : history.isError ? (
          <p className="mt-1.5 text-[11px] text-destructive">Could not load history.</p>
        ) : recentHistory.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">No workflow history yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5" data-testid="list-panel-history">
            {recentHistory.map((event, i) => (
              <li key={i} className="text-[11px]">
                <span className="font-medium text-foreground">
                  {event.oldState ?? '—'} → {event.newState ?? '—'}
                </span>{' '}
                <span className="text-muted-foreground">
                  {event.user ? `by ${event.user.replace(/^sitecore\\/i, '')}` : ''}
                  {event.date ? ` · ${new Date(event.date).toLocaleDateString()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FullAppLink href={queueHref} label={`Open ${status.state.displayName} queue`} />
    </>
  );
}

/**
 * Link into the full WorkFLO app. The panel is an embedded
 * context view, so the full app opens in a new tab at the same deployment.
 */
function FullAppLink({
  href,
  label,
  inline,
}: {
  href: string;
  label: string;
  inline?: boolean;
}) {
  const url = `${import.meta.env.BASE_URL}${href}`;
  if (inline) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline-offset-2 hover:underline"
        data-testid="link-full-app-inline"
      >
        {label}
      </a>
    );
  }
  return (
    <Button asChild variant="outline" size="sm" className="w-full" data-testid="link-full-app">
      <a href={url} target="_blank" rel="noreferrer">
        {label} <ArrowUpRight className="size-3.5" />
      </a>
    </Button>
  );
}

/**
 * One guarded command. Clicking opens an impact review; confirming
 * re-resolves the page's workflow placement and the state's commands
 * against FRESH host data immediately before the single write. Any drift
 * (page moved states, workflow changed, command revoked) aborts with a
 * precise message instead of writing.
 */
function CommandButton({
  status,
  command,
  targetStateName,
  onDone,
}: {
  status: ItemWorkflowStatus & {
    workflow: NonNullable<ItemWorkflowStatus['workflow']>;
    state: NonNullable<ItemWorkflowStatus['state']>;
  };
  command: WorkflowCommandInfo;
  targetStateName: string | null;
  onDone: () => void;
}) {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState('');

  const execute = useMutation({
    mutationFn: async () => {
      // Captured at confirmation; re-verified after every await. Catches
      // Page builder navigation and demo→live/retry host swaps that happen
      // while the guards below are still in flight.
      const expectedToken = pageToken(hostKey, status.itemId, status.language);
      const assertStillCurrent = () => {
        if (getActiveHostKey() !== hostKey) {
          throw new Error('The Sitecore connection changed, so the command was not run.');
        }
        if (currentPanelPage.token !== expectedToken) {
          throw new Error('The Page builder moved to another page, so the command was not run.');
        }
      };
      assertStillCurrent();
      // Guard 1: the page must still be in the same workflow AND state.
      const fresh = await host.getItemWorkflowStatus(status.itemId, status.language);
      assertStillCurrent();
      if (!fresh || !fresh.workflow || !fresh.state) {
        throw new Error(
          'This page is no longer in a workflow, so the command was not run.',
        );
      }
      if (
        fresh.workflow.workflowId !== status.workflow.workflowId ||
        fresh.state.stateId !== status.state.stateId
      ) {
        throw new Error(
          `This page moved to ${fresh.state.displayName} since the panel loaded, so the command was not run. The panel has been refreshed.`,
        );
      }
      // Guard 2: the command must still be offered from that state.
      const freshCommands = await host.getStateCommands(
        fresh.workflow.workflowId,
        fresh.state.stateId,
      );
      assertStillCurrent();
      if (!freshCommands.some((c) => c.commandId === command.commandId)) {
        throw new Error(
          `"${command.displayName}" is no longer available from ${fresh.state.displayName}, so the command was not run.`,
        );
      }
      const result = await host.executeCommand({
        itemId: fresh.itemId,
        language: fresh.language,
        version: fresh.version,
        commandId: command.commandId,
        comments: comments.trim() || undefined,
      });
      if (!result.successful) {
        throw new Error(result.error || 'Sitecore rejected the workflow command.');
      }
      return result;
    },
    onSettled: () => {
      // Always refresh the panel and shared caches — even a refused command
      // means our read model was stale.
      void queryClient.invalidateQueries({ queryKey: ['item-workflow-status', status.itemId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-queue', status.workflow.workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-counts', status.workflow.workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-history', status.workflow.workflowId] });
      onDone();
    },
    onSuccess: (result) => {
      appendActionLog({
        at: new Date().toISOString(),
        itemName: status.name,
        itemPath: status.path,
        command: command.displayName,
        fromState: status.state.displayName,
        toState: targetStateName,
        comments: comments.trim() || null,
      });
      toast.success(
        `${command.displayName} — ${status.name}${result.nextStateId && targetStateName ? ` moved to ${targetStateName}` : ' moved on'}.`,
      );
      setOpen(false);
      setComments('');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'The command failed.');
      setOpen(false);
      setComments('');
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
        data-testid={`button-panel-command-${command.commandId}`}
      >
        {command.displayName}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !execute.isPending) {
            setOpen(false);
            setComments('');
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-panel-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {command.displayName} — {status.name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-left">
                <p>This runs the real Sitecore workflow command:</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs">
                  <li>
                    Page: {status.path} ({status.language}
                    {status.version != null ? `, v${status.version}` : ''})
                  </li>
                  <li>
                    From: {status.state.displayName}
                    {targetStateName ? ` → To: ${targetStateName}` : ''}
                  </li>
                  <li>Workflow: {status.workflow.displayName}</li>
                </ul>
                <p className="text-xs">
                  The page&apos;s state and this command are re-checked against Sitecore
                  immediately before running.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!command.suppressComments && (
            <Textarea
              placeholder="Optional comment for the workflow history…"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              data-testid="input-panel-comments"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={execute.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => execute.mutate()}
              disabled={execute.isPending}
              data-testid="button-panel-confirm"
            >
              {execute.isPending ? 'Running…' : command.displayName}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
