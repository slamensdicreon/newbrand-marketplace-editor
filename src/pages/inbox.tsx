import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertCircle, CheckCircle2, Clock, Inbox as InboxIcon, User, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  compareInboxEntries,
  inboxItemKey,
  intersectCommands,
  resolveQueueMembership,
  useWorkInbox,
  type WorkInboxEntry,
} from '@/lib/inbox';
import { appendActionLog } from '@/lib/action-log';
import { useHost } from '@/lib/marketplace/provider';
import {
  MAX_BULK_SELECTION,
  type AgeBucket,
  type WorkflowCommandInfo,
} from '@/lib/workflow/types';

type RunResult = {
  entry: WorkInboxEntry;
  status: 'success' | 'failed' | 'stale';
  error?: string;
  nextStateId?: string | null;
};

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-xs';

export default function Inbox() {
  const inbox = useWorkInbox();
  const host = useHost();
  const queryClient = useQueryClient();
  const [workflowId, setWorkflowId] = useState('all');
  const [stateId, setStateId] = useState('all');
  const [language, setLanguage] = useState('all');
  const [urgency, setUrgency] = useState<'all' | Exclude<AgeBucket, 'unknown'>>('all');
  const [newest, setNewest] = useState(false);
  const [selected, setSelected] = useState<Map<string, WorkInboxEntry>>(new Map());
  const [pendingCommand, setPendingCommand] = useState<WorkflowCommandInfo | null>(null);
  const [comments, setComments] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[] | null>(null);

  const entries = inbox.data?.entries ?? [];
  const workflowOptions = useMemo(
    () => [...new Map(entries.map((entry) => [entry.workflow.workflowId, entry.workflow])).values()],
    [entries],
  );
  const stateOptions = useMemo(
    () =>
      [
        ...new Map(
          entries
            .filter((entry) => workflowId === 'all' || entry.workflow.workflowId === workflowId)
            .map((entry) => [entry.state.stateId, entry.state]),
        ).values(),
      ],
    [entries, workflowId],
  );
  const languages = useMemo(
    () => [...new Set(entries.map((entry) => entry.item.language))].sort(),
    [entries],
  );
  const visible = useMemo(() => {
    const filtered = entries.filter(
      (entry) =>
        (workflowId === 'all' || entry.workflow.workflowId === workflowId) &&
        (stateId === 'all' || entry.state.stateId === stateId) &&
        (language === 'all' || entry.item.language === language) &&
        (urgency === 'all' || entry.urgency === urgency),
    );
    return filtered.sort((a, b) => {
      const priority = compareInboxEntries(a, b);
      if (!newest || a.urgency !== b.urgency) return priority;
      return -priority;
    });
  }, [entries, workflowId, stateId, language, urgency, newest]);
  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const sharedCommands = useMemo(() => intersectCommands(selectedItems), [selectedItems]);
  const stats = useMemo(
    () => ({
      actionable: entries.filter((entry) => entry.commands.length > 0).length,
      stale: entries.filter((entry) => entry.urgency === 'stale').length,
      aging: entries.filter((entry) => entry.urgency === 'aging').length,
    }),
    [entries],
  );

  const toggle = (entry: WorkInboxEntry) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(entry.key)) {
        next.delete(entry.key);
      } else if (
        next.size < MAX_BULK_SELECTION &&
        entry.commands.length > 0 &&
        intersectCommands([...next.values(), entry]).length > 0
      ) {
        next.set(entry.key, entry);
      }
      return next;
    });
  };

  const run = async () => {
    if (!pendingCommand) return;
    setRunning(true);
    const command = pendingCommand;
    const outcomes: RunResult[] = [];
    try {
      // Runtime safety assertions, independent of checkbox gating: the
      // selection must stay bounded and every item must expose the chosen
      // command from its own state.
      if (selectedItems.length > MAX_BULK_SELECTION) {
        throw new Error(
          `Refusing to run a bulk command on ${selectedItems.length} items — the limit is ${MAX_BULK_SELECTION}.`,
        );
      }
      const incompatibleEntry = selectedItems.find(
        (entry) => !entry.commands.some((c) => c.commandId === command.commandId),
      );
      if (incompatibleEntry) {
        throw new Error(
          `"${incompatibleEntry.item.name}" does not offer the "${command.displayName}" command from its state, so nothing was executed.`,
        );
      }
      for (const entry of selectedItems) {
        // Re-resolve THIS identity immediately before its own write, walking
        // the queue's pages so "no longer in state" is only reported after an
        // authoritative absence. Items that changed state mid-run are skipped —
        // never substituted, retried, or widened.
        const membership = await resolveQueueMembership(
          host,
          entry.workflow.workflowId,
          entry.state.stateId,
          inboxItemKey(entry.item),
        );
        if (membership === 'unresolved') {
          outcomes.push({
            entry,
            status: 'failed',
            error:
              'Could not confirm the item is still in this state (queue too deep to verify); nothing was executed for it.',
          });
          continue;
        }
        if (membership === 'absent') {
          outcomes.push({ entry, status: 'stale' });
          continue;
        }
        // Refresh the state's available commands right before the write; a
        // command revoked mid-run is skipped with a precise outcome.
        const freshCommands = await host.getStateCommands(
          entry.workflow.workflowId,
          entry.state.stateId,
        );
        if (!freshCommands.some((candidate) => candidate.commandId === command.commandId)) {
          outcomes.push({
            entry,
            status: 'failed',
            error: `The "${command.displayName}" command is no longer available for this state; nothing was executed for it.`,
          });
          continue;
        }
        try {
          const result = await host.executeCommand({
            itemId: entry.item.itemId,
            language: entry.item.language,
            version: entry.item.version,
            commandId: command.commandId,
            comments: comments.trim() || undefined,
          });
          if (!result.successful) {
            outcomes.push({
              entry,
              status: 'failed',
              error: result.error || 'Sitecore rejected the workflow command.',
            });
            continue;
          }
          outcomes.push({
            entry,
            status: 'success',
            nextStateId: result.nextStateId,
          });
          const toState = result.nextStateId
            ? entry.workflow.states.find((state) => state.stateId === result.nextStateId)
                ?.displayName ?? result.nextStateId
            : null;
          appendActionLog({
            at: new Date().toISOString(),
            itemName: entry.item.name,
            itemPath: entry.item.path,
            command: command.displayName,
            fromState: entry.state.displayName,
            toState,
            comments: comments.trim() || null,
          });
        } catch (error) {
          outcomes.push({
            entry,
            status: 'failed',
            error: error instanceof Error ? error.message : 'The command failed.',
          });
        }
      }
    } catch (error) {
      // A freshness read failure is reported per still-unprocessed item;
      // no write is attempted without the safety check.
      const done = new Set(outcomes.map((outcome) => outcome.entry.key));
      for (const entry of selectedItems) {
        if (!done.has(entry.key)) {
          outcomes.push({
            entry,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Could not verify the fresh queue.',
          });
        }
      }
    } finally {
      setRunning(false);
      setPendingCommand(null);
      setComments('');
      setSelected(new Map());
      setResults(outcomes);
      void queryClient.invalidateQueries({ queryKey: ['work-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-history'] });
    }
  };

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader title="Work inbox" subtitle="Prioritized work across Sitecore workflows" />
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        <section className="mb-5 grid grid-cols-3 gap-3" aria-label="Inbox summary">
          <Stat label="Actionable" value={stats.actionable} loading={inbox.isLoading} testId="stat-actionable" />
          <Stat label="Stale" value={stats.stale} loading={inbox.isLoading} testId="stat-stale" />
          <Stat label="Aging" value={stats.aging} loading={inbox.isLoading} testId="stat-aging" />
        </section>

        <section className="mb-4 grid gap-2 sm:grid-cols-5" aria-label="Inbox filters">
          <select
            className={selectClass}
            value={workflowId}
            onChange={(event) => {
              setWorkflowId(event.target.value);
              setStateId('all');
            }}
            data-testid="select-workflow-filter"
            aria-label="Workflow"
          >
            <option value="all">All workflows</option>
            {workflowOptions.map((workflow) => (
              <option key={workflow.workflowId} value={workflow.workflowId}>{workflow.displayName}</option>
            ))}
          </select>
          <select className={selectClass} value={stateId} onChange={(event) => setStateId(event.target.value)} data-testid="select-state-filter" aria-label="State">
            <option value="all">All states</option>
            {stateOptions.map((state) => <option key={state.stateId} value={state.stateId}>{state.displayName}</option>)}
          </select>
          <select className={selectClass} value={language} onChange={(event) => setLanguage(event.target.value)} data-testid="select-language-filter" aria-label="Language">
            <option value="all">All languages</option>
            {languages.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className={selectClass} value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)} data-testid="select-urgency-filter" aria-label="Urgency">
            <option value="all">All urgency</option>
            <option value="stale">Stale</option>
            <option value="aging">Aging</option>
            <option value="fresh">Fresh</option>
          </select>
          <Button variant="outline" onClick={() => setNewest((value) => !value)} data-testid="button-sort-age">
            {newest ? 'Newest first' : 'Oldest first'}
          </Button>
        </section>

        {inbox.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div>
        ) : inbox.isError ? (
          <Alert variant="danger" data-testid="alert-inbox-error">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load the work inbox</AlertTitle>
            <AlertDescription>{inbox.error instanceof Error ? inbox.error.message : 'Sitecore did not return the queues.'}</AlertDescription>
          </Alert>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center" data-testid="text-empty-inbox">
            <InboxIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No work matches these filters.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((entry) => {
              const isSelected = selected.has(entry.key);
              const incompatible =
                !isSelected &&
                (entry.commands.length === 0 ||
                  selected.size >= MAX_BULK_SELECTION ||
                  (selected.size > 0 &&
                    intersectCommands([...selected.values(), entry]).length === 0));
              return (
                <li key={entry.key} className="rounded-xl border border-border bg-card p-4 shadow-sm" data-testid={`row-inbox-${entry.item.itemId}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={incompatible}
                      onChange={() => toggle(entry)}
                      aria-label={`Select ${entry.item.name}`}
                      data-testid={`checkbox-inbox-${entry.item.itemId}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold">{entry.item.name}</h2>
                          <p className="truncate text-xs text-muted-foreground" title={entry.item.path}>{entry.item.path}</p>
                        </div>
                        <Badge colorScheme={entry.urgency === 'stale' ? 'danger' : entry.urgency === 'aging' ? 'warning' : 'neutral'}>
                          <Clock className="size-3" /> {entry.reason.split(' — ')[1]?.split(' in ')[0] ?? 'unknown'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs font-medium">{entry.workflow.displayName} → {entry.state.displayName}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{entry.item.language}{entry.item.version != null ? ` · v${entry.item.version}` : ''}</span>
                        {entry.item.updatedBy && <span className="flex items-center gap-1"><User className="size-3" /> Last updated by {entry.item.updatedBy.replace(/^sitecore\\/i, '')}</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground" data-testid={`reason-${entry.item.itemId}`}>{entry.reason}</p>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/workflows/${encodeURIComponent(entry.workflow.workflowId)}/states/${encodeURIComponent(entry.state.stateId)}`}>Queue &amp; history</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(inbox.data?.remainders ?? [])
          .filter((remainder) => workflowId === 'all' || remainder.workflow.workflowId === workflowId)
          .map((remainder) => (
            <p key={`${remainder.workflow.workflowId}-${remainder.state.stateId}`} className="mt-3 text-xs text-muted-foreground" data-testid={`remainder-${remainder.state.stateId}`}>
              <Link className="underline" href={`/workflows/${encodeURIComponent(remainder.workflow.workflowId)}/states/${encodeURIComponent(remainder.state.stateId)}`}>
                {remainder.workflow.displayName} → {remainder.state.displayName}: and {remainder.remaining} more in this queue
              </Link>
            </p>
          ))}
      </main>

      {selectedItems.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-background p-3 shadow-lg" data-testid="bar-bulk-actions">
          <span className="text-sm font-medium">{selectedItems.length} selected</span>
          {sharedCommands.map((command) => <Button key={command.commandId} size="sm" onClick={() => setPendingCommand(command)} data-testid={`button-bulk-${command.commandId}`}>{command.displayName}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())} data-testid="button-clear-selection">Clear</Button>
        </div>
      )}

      <AlertDialog open={pendingCommand !== null} onOpenChange={(open) => !open && !running && setPendingCommand(null)}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingCommand?.displayName} {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>This runs the real Sitecore workflow command once per item, sequentially. Each item is freshly verified before any command is sent.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-2" data-testid="list-bulk-confirm">
            {selectedItems.map((entry) => <li key={entry.key} className="text-xs"><span className="font-medium">{entry.item.name}</span><br /><span className="text-muted-foreground">{entry.item.path} · {entry.item.language}{entry.item.version != null ? ` · v${entry.item.version}` : ''}</span></li>)}
          </ul>
          {pendingCommand && !selectedItems.some((entry) => entry.commands.find((command) => command.commandId === pendingCommand.commandId)?.suppressComments) && (
            <Textarea value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Optional shared comment…" rows={3} data-testid="input-bulk-comments" />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <Button disabled={running} onClick={() => void run()} data-testid="button-confirm-bulk">{running ? 'Running…' : 'Confirm'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={results !== null} onOpenChange={(open) => !open && setResults(null)}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk action results</AlertDialogTitle>
            <AlertDialogDescription>{results && resultSummary(results)}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2" data-testid="list-bulk-results">
            {(results ?? []).map((result) => (
              <li key={result.entry.key} className="flex gap-2 text-sm" data-testid={`result-${result.status}-${result.entry.item.itemId}`}>
                {result.status === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : <XCircle className="size-4 shrink-0 text-destructive" />}
                <span><span className="font-medium">{result.entry.item.name}</span> — {result.status === 'success' ? 'succeeded' : result.status === 'stale' ? 'skipped (no longer in state)' : result.error ?? 'failed'}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter><AlertDialogCancel data-testid="button-close-results">Close</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function resultSummary(results: RunResult[]): string {
  const success = results.filter((result) => result.status === 'success').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const stale = results.filter((result) => result.status === 'stale').length;
  return `${success} succeeded, ${failed} failed, ${stale} skipped (no longer in state).`;
}

function Stat({ label, value, loading, testId }: { label: string; value: number; loading: boolean; testId: string }) {
  return <div className="rounded-xl border bg-card p-4" data-testid={testId}>{loading ? <Skeleton className="h-8 w-12" /> : <p className="text-3xl font-bold tabular-nums">{value}</p>}<p className="text-xs text-muted-foreground">{label}</p></div>;
}