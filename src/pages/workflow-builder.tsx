import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertCircle, ArrowRight, HelpCircle, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useCreateWorkflow, useWorkflows } from '@/lib/marketplace/provider';
import { BuilderCanvas, type BuilderSelection } from '@/components/builder-canvas';
import {
  addState,
  connectStates,
  defaultDraft,
  moveState,
  removeState,
  removeTransition,
  toSpec,
  updateState,
  updateTransition,
  type BuilderDraft,
} from '@/lib/workflow/builder-draft';
import { validateDraftWorkflow } from '@/lib/workflow/types';

/**
 * Drag-and-drop workflow builder. Compose states and transitions visually,
 * then create a REAL workflow definition (workflow, states, transition
 * commands) under /sitecore/system/Workflows. Deliberately does NOT edit or
 * delete existing workflows, reorder states, or manage workflow actions —
 * the Authoring API has no first-class operations for those, so they stay
 * in native Sitecore tools instead of being faked here.
 */
export default function WorkflowBuilder() {
  const [, navigate] = useLocation();
  const workflows = useWorkflows();
  const create = useCreateWorkflow();

  const [name, setName] = useState('');
  const [draft, setDraft] = useState<BuilderDraft>(() => defaultDraft());
  const [selection, setSelection] = useState<BuilderSelection>(null);

  const spec = useMemo(() => toSpec(draft, name), [draft, name]);
  const problems = useMemo(() => validateDraftWorkflow(spec), [spec]);
  const existingNames = new Set(
    (workflows.data ?? []).map((w) => w.displayName.trim().toLowerCase()),
  );
  const duplicateName = name.trim() !== '' && existingNames.has(name.trim().toLowerCase());

  const selectedState =
    selection?.kind === 'state' ? draft.states.find((s) => s.key === selection.key) ?? null : null;
  const selectedTransition =
    selection?.kind === 'transition' ? draft.transitions[selection.index] ?? null : null;

  const onAddState = () => {
    const { draft: next, key } = addState(draft);
    setDraft(next);
    setSelection({ kind: 'state', key });
  };

  const onConnect = (fromKey: string, toKey: string) => {
    const result = connectStates(draft, fromKey, toKey);
    if (result.problem) {
      toast.error(result.problem);
      return;
    }
    setDraft(result.draft);
    // Select the new edge so the command name can be typed immediately.
    setSelection({ kind: 'transition', index: result.index });
  };

  const onRemoveState = (key: string) => {
    setDraft((prev) => removeState(prev, key));
    setSelection(null);
  };

  const onRemoveTransition = (index: number) => {
    setDraft((prev) => removeTransition(prev, index));
    setSelection(null);
  };

  const submit = () => {
    if (problems.length > 0 || duplicateName) return;
    create.mutate(spec, {
      onSuccess: () => {
        toast.success(`Workflow "${name.trim()}" created.`);
        navigate('/');
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Creating the workflow failed.');
      },
    });
  };

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title="Workflow builder"
        subtitle="Drag states and connect them to design a review flow"
        back={{ href: '/workflows', label: 'Back to workflows' }}
      />

      <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5">
        <BuilderTips />

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="wf-name">Workflow name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Brand Review"
              data-testid="input-workflow-name"
            />
          </div>
          <Button variant="outline" onClick={onAddState} data-testid="button-add-state">
            <Plus className="size-4" /> Add state
          </Button>
        </div>
        {duplicateName && (
          <p className="text-xs text-destructive" data-testid="text-duplicate-name">
            A workflow with this name already exists.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-1.5">
            <BuilderCanvas
              draft={draft}
              selection={selection}
              onSelect={setSelection}
              onMoveState={(key, to) => setDraft((prev) => moveState(prev, key, to))}
              onConnect={onConnect}
              onConnectRejected={(problem) => toast.error(problem)}
              className="min-h-[340px]"
            />
          </div>

          {/* Inspector */}
          <aside
            className="h-fit space-y-4 rounded-xl border border-border bg-card p-4"
            aria-label="Selection inspector"
            data-testid="builder-inspector"
          >
            {selectedState && selection?.kind === 'state' ? (
              <StateInspector
                draft={draft}
                stateKey={selection.key}
                onChange={(patch) => setDraft((prev) => updateState(prev, selection.key, patch))}
                onConnectTo={(toKey) => onConnect(selection.key, toKey)}
                onRemove={() => onRemoveState(selection.key)}
              />
            ) : selectedTransition && selection?.kind === 'transition' ? (
              <TransitionInspector
                draft={draft}
                index={selection.index}
                onChange={(patch) => setDraft((prev) => updateTransition(prev, selection.index, patch))}
                onRemove={() => onRemoveTransition(selection.index)}
              />
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Nothing selected</p>
                <p>
                  Select a state or a transition on the canvas to rename it, change its flags,
                  or remove it.
                </p>
              </div>
            )}
          </aside>
        </div>

        {/* Compact structured fallback for narrow screens / screen readers. */}
        <details className="rounded-lg border border-border bg-card px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            List view ({draft.states.length} states, {draft.transitions.length} transitions)
          </summary>
          <div className="space-y-3 pb-1 pt-3">
            <ul className="space-y-1" data-testid="list-states">
              {draft.states.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    className="truncate text-left text-foreground underline-offset-2 hover:underline"
                    onClick={() => setSelection({ kind: 'state', key: s.key })}
                    data-testid={`list-state-${s.key}`}
                  >
                    {s.name.trim() || '(unnamed)'}
                  </button>
                  {s.initial && <Badge colorScheme="primary" className="px-1.5 py-0 text-[9px]">initial</Badge>}
                  {s.final && <Badge colorScheme="neutral" className="px-1.5 py-0 text-[9px]">final</Badge>}
                </li>
              ))}
            </ul>
            <ul className="space-y-1" data-testid="list-transitions">
              {draft.transitions.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <button
                    type="button"
                    className="text-foreground underline-offset-2 hover:underline"
                    onClick={() => setSelection({ kind: 'transition', index: i })}
                    data-testid={`list-transition-${i}`}
                  >
                    {t.name.trim() || '(unnamed)'}
                  </button>
                  <span className="truncate">
                    {stateLabel(draft, t.fromKey)} <ArrowRight className="inline size-3" />{' '}
                    {stateLabel(draft, t.toKey)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>

        {problems.length > 0 && name.trim() !== '' && (
          <Alert variant="danger" data-testid="alert-builder-problems">
            <AlertCircle className="size-4" />
            <AlertTitle>Not quite ready</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button
          className="w-full"
          disabled={problems.length > 0 || duplicateName || create.isPending}
          onClick={submit}
          data-testid="button-create-workflow"
        >
          {create.isPending ? 'Creating…' : 'Create workflow in Sitecore'}
        </Button>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Existing workflows
          </h2>
          {workflows.isLoading ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : (
            <ul className="space-y-1.5">
              {(workflows.data ?? []).map((wf) => (
                <li
                  key={wf.workflowId}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="truncate text-sm text-foreground">{wf.displayName}</span>
                  <Badge colorScheme="neutral">{wf.states.length} states</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function stateLabel(draft: BuilderDraft, key: string): string {
  return draft.states.find((s) => s.key === key)?.name.trim() || '(unnamed)';
}

function BuilderTips() {
  return (
    <details
      className="group rounded-lg border border-border bg-card"
      data-testid="builder-tips"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <HelpCircle className="size-4 text-primary" />
        <span>Tool tips</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
          Click to learn how the builder works
        </span>
        <span className="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline">
          Click to hide
        </span>
      </summary>
      <div className="grid gap-3 border-t border-border px-3 py-3 text-sm text-muted-foreground md:grid-cols-3">
        <div>
          <p className="mb-1 font-medium text-foreground">Build from a blank canvas</p>
          <p>Add states as you need them, then set one as the initial state and any number as final states.</p>
        </div>
        <div>
          <p className="mb-1 font-medium text-foreground">Connect the flow</p>
          <p>Drag the ring on a state&apos;s right edge onto another state. Click a transition label to name its command.</p>
        </div>
        <div>
          <p className="mb-1 font-medium text-foreground">What gets created</p>
          <p>This creates a real Sitecore workflow with states and transition commands. Actions, command security, and editing existing workflows stay in native Sitecore tools.</p>
        </div>
      </div>
    </details>
  );
}

function StateInspector({
  draft,
  stateKey,
  onChange,
  onConnectTo,
  onRemove,
}: {
  draft: BuilderDraft;
  stateKey: string;
  onChange: (patch: { name?: string; initial?: boolean; final?: boolean }) => void;
  onConnectTo: (toKey: string) => void;
  onRemove: () => void;
}) {
  const state = draft.states.find((s) => s.key === stateKey)!;
  const others = draft.states.filter((s) => s.key !== stateKey);
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">State</p>
      <div className="space-y-1.5">
        <Label htmlFor="inspector-state-name">Name</Label>
        <Input
          id="inspector-state-name"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="State name"
          data-testid="input-inspector-state-name"
        />
      </div>
      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <input
            type="radio"
            name="initial-state"
            checked={state.initial}
            onChange={() => onChange({ initial: true })}
            data-testid="radio-inspector-initial"
          />
          Initial state
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={state.final}
            onChange={(e) => onChange({ final: e.target.checked })}
            data-testid="checkbox-inspector-final"
          />
          Final state
        </label>
      </div>
      {others.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="inspector-connect-to">Add transition to…</Label>
          <select
            id="inspector-connect-to"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
            value=""
            onChange={(e) => e.target.value && onConnectTo(e.target.value)}
            data-testid="select-inspector-connect"
          >
            <option value="">Choose a target state</option>
            {others.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name.trim() || '(unnamed)'}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button
        variant="outline"
        className="w-full text-destructive"
        onClick={onRemove}
        data-testid="button-inspector-remove-state"
      >
        <Trash2 className="size-4" /> Remove state
      </Button>
    </div>
  );
}

function TransitionInspector({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: BuilderDraft;
  index: number;
  onChange: (patch: { name?: string }) => void;
  onRemove: () => void;
}) {
  const t = draft.transitions[index]!;
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Transition
      </p>
      <p className="text-sm text-muted-foreground">
        {stateLabel(draft, t.fromKey)} <ArrowRight className="inline size-3" />{' '}
        {stateLabel(draft, t.toKey)}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="inspector-transition-name">Command name</Label>
        <Input
          id="inspector-transition-name"
          value={t.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Submit"
          data-testid="input-inspector-transition-name"
        />
      </div>
      <Button
        variant="outline"
        className="w-full text-destructive"
        onClick={onRemove}
        data-testid="button-inspector-remove-transition"
      >
        <Trash2 className="size-4" /> Remove transition
      </Button>
    </div>
  );
}
