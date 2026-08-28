import { useMemo, useState } from 'react';
import { useParams } from 'wouter';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Info,
  Puzzle,
  Search,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import { toast } from 'sonner';
import {
  MAX_ASSIGN_SELECTION,
  useAssignWorkflow,
  useContentChildren,
  useWorkflows,
  type AssignWorkflowOutcome,
} from '@/lib/marketplace/provider';
import type { ContentItem, ContentItemKind } from '@/lib/workflow/types';

/**
 * "Apply to content" workspace for one workflow. Editors browse a truthful,
 * lazily loaded content tree, pick an explicit bounded set of items, review
 * a visual impact summary, and confirm before anything is written. There is
 * deliberately no "apply to everything" action anywhere on this page.
 */
export default function ApplyWorkflow() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId ? decodeURIComponent(params.workflowId) : undefined;
  const workflows = useWorkflows();
  const workflow = workflows.data?.find((w) => w.workflowId === workflowId);
  const initialState = workflow?.states.find((s) => s.initial);

  // Selection is plain component state: the whole routed tree remounts on a
  // host-generation change, so demo-era selections can never leak into live.
  const [selected, setSelected] = useState<Map<string, ContentItem>>(new Map());
  const [filter, setFilter] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<AssignWorkflowOutcome | null>(null);
  const assign = useAssignWorkflow(workflowId);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);

  const toggle = (item: ContentItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.itemId)) next.delete(item.itemId);
      else if (next.size < MAX_ASSIGN_SELECTION) next.set(item.itemId, item);
      else
        toast.error(
          `Selection is limited to ${MAX_ASSIGN_SELECTION} items per operation. Apply this batch first.`,
        );
      return next;
    });
  };

  const onConfirm = () => {
    assign.mutate(selectedItems, {
      onSuccess: (result) => {
        setConfirming(false);
        setOutcome(result);
        const ok = result.results.filter((r) => r.successful).length;
        const failed = result.results.length - ok + result.stale.length;
        if (failed === 0) {
          toast.success(`Workflow applied to ${ok} item${ok === 1 ? '' : 's'}.`);
        } else if (ok > 0) {
          toast.warning(`Applied to ${ok} item${ok === 1 ? '' : 's'}; ${failed} failed.`);
        } else {
          toast.error('The workflow could not be applied to any of the selected items.');
        }
        // Keep only failed items selected so the editor can review them.
        setSelected((prev) => {
          const next = new Map<string, ContentItem>();
          for (const r of result.results) {
            if (!r.successful && prev.has(r.itemId)) next.set(r.itemId, prev.get(r.itemId)!);
          }
          return next;
        });
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(error instanceof Error ? error.message : 'Applying the workflow failed.');
      },
    });
  };

  const assignmentUnsupported = workflow != null && !initialState;

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title={workflow ? `Apply "${workflow.displayName}" to content` : 'Apply workflow'}
        subtitle="Select an explicit set of items — nothing is applied site-wide"
        back={{
          href: workflowId ? `/workflows/${encodeURIComponent(workflowId)}` : '/workflows',
          label: 'Back to workflow',
        }}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        {workflows.isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : workflows.isError || (workflows.data && !workflow) ? (
          <Alert variant="danger" data-testid="alert-workflow-error">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load this workflow</AlertTitle>
            <AlertDescription>
              {workflows.isError
                ? 'Sitecore did not return the workflow list.'
                : 'This workflow does not exist (it may have been deleted).'}
            </AlertDescription>
          </Alert>
        ) : assignmentUnsupported ? (
          <Alert data-testid="alert-assignment-unsupported">
            <Info className="size-4" />
            <AlertTitle>Assignment is unavailable for this workflow</AlertTitle>
            <AlertDescription>
              This workflow has no verified initial state, so items cannot be placed into it
              safely from here. Set the workflow&apos;s &quot;Initial state&quot; field in the
              Sitecore Content Editor under /sitecore/system/Workflows, then reload.
            </AlertDescription>
          </Alert>
        ) : workflow && initialState ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_minmax(280px,360px)]">
            {/* ---------------- Content browser ---------------- */}
            <section className="min-w-0 space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter loaded items by name or path…"
                  className="pl-8"
                  data-testid="input-content-filter"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Expand the tree to load items from Sitecore. The filter narrows items already
                loaded — it does not search the whole database.
              </p>
              <div
                className="rounded-xl border border-border bg-card p-2"
                role="tree"
                aria-label="Content tree"
              >
                <ContentLevel
                  parentId={null}
                  depth={0}
                  filter={filter.trim().toLowerCase()}
                  selected={selected}
                  onToggle={toggle}
                />
              </div>
            </section>

            {/* ---------------- Impact summary ---------------- */}
            <aside className="space-y-3">
              <section
                className="rounded-xl border border-border bg-card p-4"
                data-testid="panel-impact"
              >
                <h2 className="text-sm font-semibold text-foreground">
                  Impact — {selectedItems.length} of {MAX_ASSIGN_SELECTION} items
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each selected item will be placed into{' '}
                  <span className="font-medium text-foreground">{workflow.displayName}</span> at
                  its initial state{' '}
                  <span className="font-medium text-foreground">{initialState.displayName}</span>.
                </p>
                {selectedItems.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground" data-testid="text-empty-selection">
                    No items selected yet. Tick items in the tree to build the exact set this
                    workflow will be applied to.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {selectedItems.map((item) => (
                      <li
                        key={item.itemId}
                        className="rounded-lg border border-border px-2.5 py-2"
                        data-testid={`impact-item-${item.itemId}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <KindIcon kind={item.kind} />
                            <span className="truncate text-xs font-medium text-foreground">
                              {item.name}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px]"
                            onClick={() => toggle(item)}
                            data-testid={`button-unselect-${item.itemId}`}
                          >
                            Remove
                          </Button>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.path}>
                          {item.path}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.workflowState
                            ? `${item.workflow?.displayName ?? 'workflow'} · ${item.workflowState.displayName}`
                            : 'No workflow'}{' '}
                          → <span className="text-foreground">{initialState.displayName}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  className="mt-3 w-full"
                  disabled={selectedItems.length === 0 || assign.isPending}
                  onClick={() => setConfirming(true)}
                  data-testid="button-review-apply"
                >
                  Apply to {selectedItems.length} selected item
                  {selectedItems.length === 1 ? '' : 's'}…
                </Button>
              </section>

              {outcome && <OutcomePanel outcome={outcome} />}

              <Alert>
                <Info className="size-4" />
                <AlertDescription className="text-xs">
                  Applying to an entire site or tree, and advanced query-based selection, stay in
                  the native Sitecore Content Editor by design.
                </AlertDescription>
              </Alert>
            </aside>
          </div>
        ) : null}
      </main>

      {/* ---------------- Confirmation ---------------- */}
      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply “{workflow?.displayName}” to {selectedItems.length} item
              {selectedItems.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every item below will be re-verified against Sitecore and then placed into{' '}
              {workflow?.displayName} at {initialState?.displayName}. Items that changed or
              disappeared are reported, never substituted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {selectedItems.map((item) => (
              <li key={item.itemId} className="truncate text-xs text-foreground" title={item.path}>
                <span className="font-medium">{item.name}</span>{' '}
                <span className="text-muted-foreground">— {item.path}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={assign.isPending} data-testid="button-cancel-apply">
              Cancel
            </AlertDialogCancel>
            <Button onClick={onConfirm} disabled={assign.isPending} data-testid="button-confirm-apply">
              {assign.isPending ? 'Applying…' : `Apply workflow`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One lazily loaded level of the content tree. */
function ContentLevel({
  parentId,
  depth,
  filter,
  selected,
  onToggle,
}: {
  parentId: string | null;
  depth: number;
  filter: string;
  selected: Map<string, ContentItem>;
  onToggle: (item: ContentItem) => void;
}) {
  const children = useContentChildren(parentId);

  if (children.isLoading) {
    return (
      <div className="space-y-1.5 py-1" style={{ paddingLeft: depth * 20 }}>
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-8 w-1/2 rounded-md" />
      </div>
    );
  }
  if (children.isError) {
    return (
      <p className="px-2 py-1.5 text-xs text-destructive" style={{ paddingLeft: depth * 20 + 8 }}>
        Could not load this level.{' '}
        <button className="underline" onClick={() => void children.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  const items = children.data ?? [];
  if (items.length === 0) {
    return (
      <p
        className="px-2 py-1.5 text-xs text-muted-foreground"
        style={{ paddingLeft: depth * 20 + 8 }}
        data-testid={depth === 0 ? 'text-empty-tree' : undefined}
      >
        {depth === 0 ? 'No content items are visible to this app.' : 'No children.'}
      </p>
    );
  }
  return (
    <ul role={depth === 0 ? undefined : 'group'} className="space-y-0.5">
      {items.map((item) => (
        <ContentRow
          key={item.itemId}
          item={item}
          depth={depth}
          filter={filter}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function matchesFilter(item: ContentItem, filter: string): boolean {
  if (!filter) return true;
  return (
    item.name.toLowerCase().includes(filter) || item.path.toLowerCase().includes(filter)
  );
}

function ContentRow({
  item,
  depth,
  filter,
  selected,
  onToggle,
}: {
  item: ContentItem;
  depth: number;
  filter: string;
  selected: Map<string, ContentItem>;
  onToggle: (item: ContentItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selected.has(item.itemId);
  // Keep parents visible while filtering so expanded children stay reachable.
  const visible = matchesFilter(item, filter) || (item.hasChildren && expanded);
  if (!visible) return null;

  return (
    <li role="treeitem" aria-expanded={item.hasChildren ? expanded : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-neutral-bg ${
          isSelected ? 'bg-primary/5' : ''
        }`}
        style={{ paddingLeft: depth * 20 + 6 }}
        data-testid={`row-content-${item.itemId}`}
      >
        {item.hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            aria-label={expanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
            data-testid={`button-expand-${item.itemId}`}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(item)}
          aria-label={`Select ${item.name}`}
          data-testid={`checkbox-select-${item.itemId}`}
        />
        <KindIcon kind={item.kind} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={item.path}>
          {item.name}
        </span>
        <Badge colorScheme="neutral" className="hidden shrink-0 text-[10px] sm:inline-flex">
          {item.templateName}
        </Badge>
        {item.workflowState ? (
          <Badge colorScheme="primary" className="shrink-0 text-[10px]">
            {item.workflowState.displayName}
          </Badge>
        ) : (
          <Badge colorScheme="neutral" className="shrink-0 text-[10px]">
            no workflow
          </Badge>
        )}
      </div>
      {item.hasChildren && expanded && (
        <ContentLevel
          parentId={item.itemId}
          depth={depth + 1}
          filter={filter}
          selected={selected}
          onToggle={onToggle}
        />
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: ContentItemKind }) {
  if (kind === 'folder') return <Folder className="size-3.5 shrink-0 text-muted-foreground" />;
  if (kind === 'component') return <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
}

function OutcomePanel({ outcome }: { outcome: AssignWorkflowOutcome }) {
  const ok = outcome.results.filter((r) => r.successful);
  const failed = outcome.results.filter((r) => !r.successful);
  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="panel-outcome">
      <h2 className="text-sm font-semibold text-foreground">Last result</h2>
      <ul className="mt-2 space-y-1.5">
        {ok.map((r) => (
          <li key={r.itemId} className="flex items-start gap-1.5 text-xs" data-testid={`result-ok-${r.itemId}`}>
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{r.name}</span>{' '}
              <span className="text-muted-foreground">applied</span>
            </span>
          </li>
        ))}
        {failed.map((r) => (
          <li key={r.itemId} className="flex items-start gap-1.5 text-xs" data-testid={`result-failed-${r.itemId}`}>
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{r.name}</span>{' '}
              <span className="text-muted-foreground">— {r.error ?? 'failed'}</span>
            </span>
          </li>
        ))}
        {outcome.stale.map((s) => (
          <li key={s.itemId} className="flex items-start gap-1.5 text-xs" data-testid={`result-stale-${s.itemId}`}>
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{s.name}</span>{' '}
              <span className="text-muted-foreground">
                — no longer exists in Sitecore, so it was skipped.
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
