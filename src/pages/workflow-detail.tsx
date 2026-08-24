import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { AlertCircle, ArrowRight, Info, ListChecks, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import {
  useAddState,
  useAddTransition,
  useDeleteDefinitionItem,
  useStateCounts,
  useWorkflowGraph,
  useWorkflows,
} from '@/lib/marketplace/provider';

/**
 * Workflow detail & management. Visual diagram plus the two safe,
 * API-verified management operations: adding states/transitions
 * (createItem) and deleting definition parts (deleteItem → recycle bin,
 * never permanent). Renaming, reordering and workflow actions have no
 * Authoring API, so they stay in native Sitecore tools — said explicitly
 * rather than faked.
 */
export default function WorkflowDetail() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId ? decodeURIComponent(params.workflowId) : undefined;
  const [, navigate] = useLocation();

  const workflows = useWorkflows();
  const graph = useWorkflowGraph(workflowId);
  const stateIds = useMemo(
    () => (graph.data ? graph.data.states.map((s) => s.stateId) : []),
    [graph.data],
  );
  const counts = useStateCounts(workflowId, stateIds);
  const addState = useAddState();
  const addTransition = useAddTransition();
  const deleteItem = useDeleteDefinitionItem();

  const workflow = workflows.data?.find((w) => w.workflowId === workflowId);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);

  // Add-state form
  const [newStateName, setNewStateName] = useState('');
  const [newStateFinal, setNewStateFinal] = useState(false);
  // Add-transition form
  const [newCmdName, setNewCmdName] = useState('');
  const [cmdFrom, setCmdFrom] = useState('');
  const [cmdTo, setCmdTo] = useState('');
  // Delete-workflow confirmation
  const [confirmName, setConfirmName] = useState('');

  const totalItems = counts.data
    ? Object.values(counts.data).reduce((sum, n) => sum + n, 0)
    : null;

  const selectedState = graph.data?.states.find((s) => s.stateId === selectedStateId) ?? null;
  const selectedCount = selectedStateId ? counts.data?.[selectedStateId] : undefined;
  const inboundToSelected =
    graph.data?.transitions.filter(
      (t) => t.toStateId === selectedStateId && t.fromStateId !== selectedStateId,
    ) ?? [];
  const outboundFromSelected =
    graph.data?.transitions.filter((t) => t.fromStateId === selectedStateId) ?? [];

  const busy = addState.isPending || addTransition.isPending || deleteItem.isPending;

  const onAddState = () => {
    if (!workflowId || newStateName.trim() === '') return;
    addState.mutate(
      { workflowId, name: newStateName.trim(), final: newStateFinal },
      {
        onSuccess: () => {
          toast.success(`State "${newStateName.trim()}" added.`);
          setNewStateName('');
          setNewStateFinal(false);
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Adding the state failed.'),
      },
    );
  };

  const onAddTransition = () => {
    if (newCmdName.trim() === '' || !cmdFrom || !cmdTo || cmdFrom === cmdTo) return;
    addTransition.mutate(
      { fromStateId: cmdFrom, name: newCmdName.trim(), toStateId: cmdTo },
      {
        onSuccess: () => {
          toast.success(`Transition "${newCmdName.trim()}" added.`);
          setNewCmdName('');
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Adding the transition failed.'),
      },
    );
  };

  const onDeleteTransition = (commandId: string, label: string) => {
    deleteItem.mutate(
      { itemId: commandId },
      {
        onSuccess: () => toast.success(`Transition "${label}" moved to the recycle bin.`),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Deleting the transition failed.'),
      },
    );
  };

  const selectedStateBlockers: string[] = [];
  if (selectedState) {
    if (selectedState.initial) selectedStateBlockers.push('it is the initial state');
    // Fail closed: never allow deletion until this state's live count is known.
    if (counts.isLoading) selectedStateBlockers.push('its item count is still loading');
    else if (counts.isError || selectedCount == null)
      selectedStateBlockers.push('its item count could not be verified');
    if (selectedCount != null && selectedCount > 0)
      selectedStateBlockers.push(
        `${selectedCount} item${selectedCount === 1 ? '' : 's'} currently sit in it`,
      );
    if (inboundToSelected.length > 0)
      selectedStateBlockers.push(
        `${inboundToSelected.length} transition${inboundToSelected.length === 1 ? '' : 's'} from other states point at it (delete those first)`,
      );
  }

  const onDeleteState = () => {
    if (!selectedState || selectedStateBlockers.length > 0) return;
    deleteItem.mutate(
      { itemId: selectedState.stateId },
      {
        onSuccess: () => {
          toast.success(`State "${selectedState.displayName}" moved to the recycle bin.`);
          setSelectedStateId(null);
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Deleting the state failed.'),
      },
    );
  };

  const workflowDeleteBlocked =
    totalItems == null || totalItems > 0 || counts.isLoading || counts.isError;

  const onDeleteWorkflow = async () => {
    if (!workflow || workflowDeleteBlocked) return;
    if (confirmName.trim() !== workflow.displayName.trim()) return;
    // Revalidate counts right before deleting to close the stale-cache race.
    const fresh = await counts.refetch();
    const freshTotal = fresh.data
      ? Object.values(fresh.data).reduce((sum, n) => sum + n, 0)
      : null;
    if (freshTotal == null || freshTotal > 0) {
      toast.error(
        freshTotal == null
          ? 'Could not re-verify item counts; deletion cancelled.'
          : `Deletion cancelled: ${freshTotal} item${freshTotal === 1 ? '' : 's'} entered this workflow since the page loaded.`,
      );
      return;
    }
    deleteItem.mutate(
      { itemId: workflow.workflowId },
      {
        onSuccess: () => {
          toast.success(
            `Workflow "${workflow.displayName}" moved to the recycle bin. Restore it from the Content Editor if needed.`,
          );
          navigate('/');
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Deleting the workflow failed.'),
      },
    );
  };

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title={workflow?.displayName ?? 'Workflow'}
        subtitle="Definition & management"
        back={{ href: '/', label: 'Back to workflows' }}
        right={
          workflowId ? (
            <Button asChild variant="outline" size="sm" data-testid="link-apply-workflow">
              <Link href={`/workflows/${encodeURIComponent(workflowId)}/apply`}>
                <ListChecks className="size-4" /> Apply to content
              </Link>
            </Button>
          ) : undefined
        }
      />

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-5">
        {graph.isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : graph.isError ? (
          <Alert variant="danger" data-testid="alert-graph-error">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load this workflow</AlertTitle>
            <AlertDescription>
              {graph.error instanceof Error
                ? graph.error.message
                : 'Sitecore did not return the workflow definition.'}
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void graph.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : graph.data ? (
          <>
            <section className="space-y-2">
              <WorkflowCanvas
                graph={graph.data}
                countsByState={counts.data}
                selectedStateId={selectedStateId}
                onSelectState={(id) =>
                  setSelectedStateId((prev) => (prev === id ? null : id))
                }
              />
              <p className="text-xs text-muted-foreground">
                Click a state to inspect and manage it. Solid arrows move content forward;
                dashed arrows send it back.
              </p>
            </section>

            {/* Accessible, non-visual fallback of the same graph. */}
            <section aria-label="States list" className="space-y-1.5">
              {graph.data.states.map((state) => (
                <div
                  key={state.stateId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-foreground">{state.displayName}</span>
                    {state.initial && <Badge colorScheme="neutral" className="text-[10px]">initial</Badge>}
                    {state.final && <Badge colorScheme="neutral" className="text-[10px]">final</Badge>}
                    <Badge colorScheme="neutral" className="text-[10px]">
                      {counts.data?.[state.stateId] ?? 0} items
                    </Badge>
                  </span>
                  <Button asChild size="sm" variant="ghost" data-testid={`link-queue-${state.stateId}`}>
                    <Link
                      href={`/workflows/${encodeURIComponent(graph.data!.workflowId)}/states/${encodeURIComponent(state.stateId)}`}
                    >
                      Open queue <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              ))}
              {/* Semantic transition list so non-visual editors can review
                  the graph's edges, not just its states. */}
              <div className="sr-only" aria-label="Transitions list">
                <ul>
                  {graph.data.transitions.map((t) => {
                    const from = graph.data!.states.find((s) => s.stateId === t.fromStateId);
                    const to = graph.data!.states.find((s) => s.stateId === t.toStateId);
                    return (
                      <li key={t.commandId}>
                        {t.displayName}: from {from?.displayName ?? 'unknown state'} to{' '}
                        {to?.displayName ?? 'no target state'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            {selectedState && (
              <section
                className="space-y-3 rounded-xl border border-primary/40 bg-card p-4"
                data-testid="panel-selected-state"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedState.displayName}
                  </h2>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedStateBlockers.length > 0 || busy}
                    onClick={onDeleteState}
                    data-testid="button-delete-state"
                  >
                    <Trash2 className="size-4" /> Delete state
                  </Button>
                </div>
                {selectedStateBlockers.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Can’t delete this state: {selectedStateBlockers.join('; ')}.
                  </p>
                )}
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Outgoing transitions
                  </h3>
                  {outboundFromSelected.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {outboundFromSelected.map((t) => {
                        const target = graph.data!.states.find((s) => s.stateId === t.toStateId);
                        return (
                          <li
                            key={t.commandId}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
                          >
                            <span className="truncate text-xs text-foreground">
                              {t.displayName}{' '}
                              <span className="text-muted-foreground">
                                → {target?.displayName ?? '(unset)'}
                              </span>
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              disabled={busy}
                              onClick={() => onDeleteTransition(t.commandId, t.displayName)}
                              aria-label={`Delete transition ${t.displayName}`}
                              data-testid={`button-delete-transition-${t.commandId}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            )}

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">Add a state</h2>
                <Label htmlFor="new-state-name" className="sr-only">
                  State name
                </Label>
                <Input
                  id="new-state-name"
                  value={newStateName}
                  onChange={(e) => setNewStateName(e.target.value)}
                  placeholder="e.g. Legal Review"
                  data-testid="input-new-state-name"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newStateFinal}
                    onChange={(e) => setNewStateFinal(e.target.checked)}
                    data-testid="checkbox-new-state-final"
                  />
                  final state (content is publishable here)
                </label>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={newStateName.trim() === '' || busy}
                  onClick={onAddState}
                  data-testid="button-add-state"
                >
                  <Plus className="size-4" /> {addState.isPending ? 'Adding…' : 'Add state'}
                </Button>
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">Add a transition</h2>
                <Label htmlFor="new-cmd-name" className="sr-only">
                  Command name
                </Label>
                <Input
                  id="new-cmd-name"
                  value={newCmdName}
                  onChange={(e) => setNewCmdName(e.target.value)}
                  placeholder="Command, e.g. Escalate"
                  data-testid="input-new-transition-name"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={cmdFrom}
                    onChange={(e) => setCmdFrom(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    data-testid="select-transition-from"
                  >
                    <option value="">From state…</option>
                    {graph.data.states.map((s) => (
                      <option key={s.stateId} value={s.stateId}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">→</span>
                  <select
                    value={cmdTo}
                    onChange={(e) => setCmdTo(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    data-testid="select-transition-to"
                  >
                    <option value="">To state…</option>
                    {graph.data.states.map((s) => (
                      <option key={s.stateId} value={s.stateId}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                {cmdFrom !== '' && cmdFrom === cmdTo && (
                  <p className="text-xs text-destructive">
                    A transition must move content to a different state.
                  </p>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  disabled={
                    newCmdName.trim() === '' || !cmdFrom || !cmdTo || cmdFrom === cmdTo || busy
                  }
                  onClick={onAddTransition}
                  data-testid="button-add-transition"
                >
                  <Plus className="size-4" />{' '}
                  {addTransition.isPending ? 'Adding…' : 'Add transition'}
                </Button>
              </div>
            </section>

            <Alert data-testid="alert-native-tools">
              <Info className="size-4" />
              <AlertTitle>Managed in native Sitecore tools</AlertTitle>
              <AlertDescription>
                Renaming states or commands, reordering, command security, and workflow{' '}
                <em>actions</em> (auto-publish, notification emails) have no Authoring API, so
                edit those in the Content Editor under /sitecore/system/Workflows. Everything
                deleted here goes to the Sitecore recycle bin and can be restored there.
              </AlertDescription>
            </Alert>

            {workflow && (
              <section
                className="space-y-2 rounded-xl border border-destructive/40 bg-card p-4"
                data-testid="section-delete-workflow"
              >
                <h2 className="text-sm font-semibold text-destructive">Delete this workflow</h2>
                {workflowDeleteBlocked ? (
                  <p className="text-xs text-muted-foreground">
                    {counts.isLoading
                      ? 'Checking whether any items are still in this workflow…'
                      : counts.isError
                        ? 'Item counts are unavailable, so deletion is disabled to be safe.'
                        : `Blocked: ${totalItems} item${totalItems === 1 ? '' : 's'} still sit in this workflow. Move them out first.`}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      No items are in this workflow. Deleting moves the whole definition to the
                      Sitecore recycle bin (restorable). Type the workflow name to confirm.
                    </p>
                    <Input
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={workflow.displayName}
                      data-testid="input-confirm-delete"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      disabled={confirmName.trim() !== workflow.displayName.trim() || busy}
                      onClick={() => void onDeleteWorkflow()}
                      data-testid="button-delete-workflow"
                    >
                      <Trash2 className="size-4" />{' '}
                      {deleteItem.isPending ? 'Deleting…' : 'Move workflow to recycle bin'}
                    </Button>
                  </>
                )}
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
