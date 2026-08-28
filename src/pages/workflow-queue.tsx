import { useMemo, useState } from 'react';
import { useParams } from 'wouter';
import { AlertCircle, Clock, History, Inbox, User } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
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
  useExecuteCommand,
  useItemHistory,
  useStateCommands,
  useWorkflowQueue,
  useWorkflows,
} from '@/lib/marketplace/provider';
import { appendActionLog } from '@/lib/action-log';
import {
  ageBucket,
  formatAge,
  type QueueItem,
  type WorkflowCommandInfo,
  type WorkflowStateInfo,
} from '@/lib/workflow/types';

/** Queue for one workflow state: items, ages, history and commands. */
export default function WorkflowQueue() {
  const params = useParams();
  const workflowId = decodeURIComponent(params['workflowId'] ?? '');
  const stateId = decodeURIComponent(params['stateId'] ?? '');

  const workflows = useWorkflows();
  const workflow = workflows.data?.find((w) => w.workflowId === workflowId);
  const state = workflow?.states.find((s) => s.stateId === stateId);

  const queue = useWorkflowQueue(workflowId, stateId);
  const commands = useStateCommands(workflowId, stateId);
  const items = useMemo(
    () => queue.data?.pages.flatMap((page) => page.items) ?? [],
    [queue.data],
  );

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title={state?.displayName ?? 'Queue'}
        subtitle={workflow?.displayName}
        back={{ href: '/workflows', label: 'Back to workflows' }}
      />

      <main className="mx-auto w-full max-w-2xl px-4 py-5">
        {queue.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : queue.isError ? (
          <Alert variant="danger" data-testid="alert-queue-error">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load this queue</AlertTitle>
            <AlertDescription>
              {queue.error instanceof Error ? queue.error.message : 'Unknown error.'}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void queue.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((item) => (
              <QueueItemCard
                key={`${item.itemId}-${item.language}-${item.version ?? 0}`}
                workflowId={workflowId}
                stateName={state?.displayName ?? ''}
                states={workflow?.states ?? []}
                item={item}
                commands={commands.data ?? []}
                commandsLoading={commands.isLoading}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Inbox className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground" data-testid="text-empty-queue">
              Nothing is waiting in {state?.displayName ?? 'this state'}.
            </p>
          </div>
        )}
        {queue.hasNextPage && (
          <div className="mt-4 text-center">
            <Button
              variant="outline"
              size="sm"
              disabled={queue.isFetchingNextPage}
              onClick={() => void queue.fetchNextPage()}
              data-testid="button-load-more"
            >
              {queue.isFetchingNextPage ? 'Loading…' : 'Load more items'}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

function QueueItemCard({
  workflowId,
  stateName,
  states,
  item,
  commands,
  commandsLoading,
}: {
  workflowId: string;
  stateName: string;
  states: WorkflowStateInfo[];
  item: QueueItem;
  commands: WorkflowCommandInfo[];
  commandsLoading: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<WorkflowCommandInfo | null>(null);
  const [comments, setComments] = useState('');
  const execute = useExecuteCommand(workflowId);
  const bucket = ageBucket(item.updatedAt);

  const confirm = () => {
    if (!pendingCommand) return;
    execute.mutate(
      {
        itemId: item.itemId,
        language: item.language,
        version: item.version,
        commandId: pendingCommand.commandId,
        comments: comments.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          const toState = result.nextStateId
            ? (states.find((s) => s.stateId === result.nextStateId)?.displayName ??
              result.nextStateId)
            : null;
          appendActionLog({
            at: new Date().toISOString(),
            itemName: item.name,
            itemPath: item.path,
            command: pendingCommand.displayName,
            fromState: stateName,
            toState,
            comments: comments.trim() || null,
          });
          toast.success(
            toState
              ? `${pendingCommand.displayName} — ${item.name} moved to ${toState}.`
              : `${pendingCommand.displayName} — ${item.name} moved on.`,
          );
          setPendingCommand(null);
          setComments('');
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'The command failed.');
        },
      },
    );
  };

  return (
    <li
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`card-queue-item-${item.itemId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{item.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.path}>
            {item.path}
          </p>
        </div>
        <Badge
          colorScheme={bucket === 'stale' ? 'danger' : bucket === 'aging' ? 'warning' : 'neutral'}
          className="shrink-0"
          data-testid={`badge-age-${item.itemId}`}
        >
          <Clock className="size-3" /> {formatAge(item.updatedAt)}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{item.language}</span>
        {item.version != null && <span>v{item.version}</span>}
        {item.updatedBy && (
          <span className="flex items-center gap-1">
            <User className="size-3" />
            {item.updatedBy.replace(/^sitecore\\/i, '')}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {commandsLoading ? (
          <Skeleton className="h-8 w-24 rounded-md" />
        ) : commands.length > 0 ? (
          commands.map((command) => (
            <Button
              key={command.commandId}
              size="sm"
              variant="outline"
              onClick={() => setPendingCommand(command)}
              data-testid={`button-command-${command.commandId}-${item.itemId}`}
            >
              {command.displayName}
            </Button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">
            No commands from this state — it is a final state.
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setShowHistory((v) => !v)}
          data-testid={`button-history-${item.itemId}`}
        >
          <History className="size-4" /> History
        </Button>
      </div>

      {showHistory && (
        <ItemHistory workflowId={workflowId} itemId={item.itemId} language={item.language} />
      )}

      <AlertDialog
        open={pendingCommand !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCommand(null);
            setComments('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingCommand?.displayName} — {item.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This runs the real Sitecore workflow command on {item.path} ({item.language}
              {item.version != null ? `, v${item.version}` : ''}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingCommand && !pendingCommand.suppressComments && (
            <Textarea
              placeholder="Optional comment for the workflow history…"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              data-testid="input-command-comments"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={execute.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={confirm}
              disabled={execute.isPending}
              data-testid="button-confirm-command"
            >
              {execute.isPending ? 'Running…' : pendingCommand?.displayName}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function ItemHistory({
  workflowId,
  itemId,
  language,
}: {
  workflowId: string;
  itemId: string;
  language: string;
}) {
  const history = useItemHistory(workflowId, itemId, language);
  const events = useMemo(() => (history.data ? [...history.data].reverse() : []), [history.data]);

  return (
    <div className="mt-3 rounded-lg border border-border bg-neutral-bg/50 p-3">
      {history.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : history.isError ? (
        <p className="text-xs text-destructive">Could not load history.</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No workflow history recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((event, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium text-foreground">
                {event.oldState ?? '—'} → {event.newState ?? '—'}
              </span>{' '}
              <span className="text-muted-foreground">
                {event.user ? `by ${event.user.replace(/^sitecore\\/i, '')}` : ''}
                {event.date ? ` · ${new Date(event.date).toLocaleString()}` : ''}
              </span>
              {event.comments.length > 0 && (
                <p className="mt-0.5 text-muted-foreground">“{event.comments.join(' · ')}”</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
