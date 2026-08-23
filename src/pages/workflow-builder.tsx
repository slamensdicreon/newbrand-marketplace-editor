import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertCircle, Info, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useCreateWorkflow, useWorkflows } from '@/lib/marketplace/provider';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import {
  validateDraftWorkflow,
  type DraftState,
  type DraftTransition,
  type DraftWorkflowSpec,
  type WorkflowGraph,
} from '@/lib/workflow/types';

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `s${keyCounter}`;
}

function defaultStates(): DraftState[] {
  return [
    { key: nextKey(), name: 'Draft', initial: true, final: false },
    { key: nextKey(), name: 'Awaiting Approval', initial: false, final: false },
    { key: nextKey(), name: 'Approved', initial: false, final: true },
  ];
}

function defaultTransitions(states: DraftState[]): DraftTransition[] {
  return [
    { name: 'Submit', fromKey: states[0]!.key, toKey: states[1]!.key },
    { name: 'Approve', fromKey: states[1]!.key, toKey: states[2]!.key },
    { name: 'Reject', fromKey: states[1]!.key, toKey: states[0]!.key },
  ];
}

/**
 * Starter workflow builder. Creates real workflow definitions (workflow,
 * states, transition commands) under /sitecore/system/Workflows using the
 * standard Sitecore templates. Deliberately does NOT edit or delete
 * existing workflows, reorder states, or manage workflow actions — the
 * Authoring API has no first-class operations for those, so they stay in
 * native Sitecore tools instead of being faked here.
 */
export default function WorkflowBuilder() {
  const [, navigate] = useLocation();
  const workflows = useWorkflows();
  const create = useCreateWorkflow();

  const [name, setName] = useState('');
  // One snapshot per mount so the default transitions reference the same
  // state keys as the default states.
  const [initialDraft] = useState(() => {
    const s = defaultStates();
    return { states: s, transitions: defaultTransitions(s) };
  });
  const [states, setStates] = useState<DraftState[]>(initialDraft.states);
  const [transitions, setTransitions] = useState<DraftTransition[]>(initialDraft.transitions);

  const spec: DraftWorkflowSpec = useMemo(
    () => ({ name, states, transitions }),
    [name, states, transitions],
  );
  // Live diagram of the draft: state keys stand in for state ids.
  const draftGraph: WorkflowGraph = useMemo(
    () => ({
      workflowId: 'draft',
      states: states.map((s) => ({
        stateId: s.key,
        displayName: s.name.trim() || '(unnamed)',
        initial: s.initial,
        final: s.final,
      })),
      transitions: transitions.map((t, i) => ({
        commandId: `t${i}`,
        displayName: t.name.trim() || '(unnamed)',
        fromStateId: t.fromKey,
        toStateId: t.toKey,
      })),
    }),
    [states, transitions],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const problems = useMemo(() => validateDraftWorkflow(spec), [spec]);
  const existingNames = new Set(
    (workflows.data ?? []).map((w) => w.displayName.trim().toLowerCase()),
  );
  const duplicateName = name.trim() !== '' && existingNames.has(name.trim().toLowerCase());

  const updateState = (key: string, patch: Partial<DraftState>) => {
    setStates((prev) =>
      prev.map((s) => {
        if (s.key !== key) {
          // Only one initial state: setting one clears the others.
          return patch.initial ? { ...s, initial: false } : s;
        }
        return { ...s, ...patch };
      }),
    );
  };

  const removeState = (key: string) => {
    setStates((prev) => prev.filter((s) => s.key !== key));
    setTransitions((prev) => prev.filter((t) => t.fromKey !== key && t.toKey !== key));
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
        subtitle="Create a basic review flow"
        back={{ href: '/', label: 'Back to workflows' }}
      />

      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5">
        <Alert data-testid="alert-builder-scope">
          <Info className="size-4" />
          <AlertTitle>What this builder does</AlertTitle>
          <AlertDescription>
            It creates a real workflow definition — states and transition commands — in
            Sitecore. Editing or deleting existing workflows, reordering states, security on
            commands, and workflow <em>actions</em> (auto-publish, emails) are not exposed by
            the Authoring API, so manage those in the Content Editor.
          </AlertDescription>
        </Alert>

        <section className="space-y-2">
          <Label htmlFor="wf-name">Workflow name</Label>
          <Input
            id="wf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. New Brand Review"
            data-testid="input-workflow-name"
          />
          {duplicateName && (
            <p className="text-xs text-destructive">A workflow with this name already exists.</p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Live preview</h2>
          <WorkflowCanvas
            graph={draftGraph}
            selectedStateId={selectedKey}
            onSelectState={(key) => setSelectedKey((prev) => (prev === key ? null : key))}
          />
          <p className="text-xs text-muted-foreground">
            The diagram updates as you edit below. Click a state to highlight its row.
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">States</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setStates((prev) => [
                  ...prev,
                  { key: nextKey(), name: '', initial: false, final: false },
                ])
              }
              data-testid="button-add-state"
            >
              <Plus className="size-4" /> Add state
            </Button>
          </div>
          <ul className="space-y-2">
            {states.map((state) => (
              <li
                key={state.key}
                className={`flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 ${
                  selectedKey === state.key ? 'border-primary ring-1 ring-primary' : 'border-border'
                }`}
              >
                <Input
                  value={state.name}
                  onChange={(e) => updateState(state.key, { name: e.target.value })}
                  placeholder="State name"
                  className="h-8 w-40 flex-1"
                  data-testid={`input-state-name-${state.key}`}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="radio"
                    name="initial-state"
                    checked={state.initial}
                    onChange={() => updateState(state.key, { initial: true })}
                    data-testid={`radio-initial-${state.key}`}
                  />
                  initial
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={state.final}
                    onChange={(e) => updateState(state.key, { final: e.target.checked })}
                    data-testid={`checkbox-final-${state.key}`}
                  />
                  final
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => removeState(state.key)}
                  aria-label={`Remove state ${state.name || '(unnamed)'}`}
                  data-testid={`button-remove-state-${state.key}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Transitions</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={states.length < 2}
              onClick={() =>
                setTransitions((prev) => [
                  ...prev,
                  { name: '', fromKey: states[0]!.key, toKey: states[1]!.key },
                ])
              }
              data-testid="button-add-transition"
            >
              <Plus className="size-4" /> Add transition
            </Button>
          </div>
          <ul className="space-y-2">
            {transitions.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <Input
                  value={t.name}
                  onChange={(e) =>
                    setTransitions((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="Command, e.g. Submit"
                  className="h-8 w-32 flex-1"
                  data-testid={`input-transition-name-${i}`}
                />
                <StateSelect
                  value={t.fromKey}
                  states={states}
                  onChange={(fromKey) =>
                    setTransitions((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, fromKey } : x)),
                    )
                  }
                  testId={`select-from-${i}`}
                />
                <span className="text-xs text-muted-foreground">→</span>
                <StateSelect
                  value={t.toKey}
                  states={states}
                  onChange={(toKey) =>
                    setTransitions((prev) => prev.map((x, j) => (j === i ? { ...x, toKey } : x)))
                  }
                  testId={`select-to-${i}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setTransitions((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove transition"
                  data-testid={`button-remove-transition-${i}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>

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

function StateSelect({
  value,
  states,
  onChange,
  testId,
}: {
  value: string;
  states: DraftState[];
  onChange: (key: string) => void;
  testId: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      data-testid={testId}
    >
      {states.map((s) => (
        <option key={s.key} value={s.key}>
          {s.name || '(unnamed)'}
        </option>
      ))}
    </select>
  );
}
