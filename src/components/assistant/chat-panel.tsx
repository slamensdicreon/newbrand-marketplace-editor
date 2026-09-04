import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Check, Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { FLOAvatar } from '@/components/workflo-brand';
import { cn } from '@/lib/utils';
import {
  useAddState,
  useAddTransition,
  useCreateWorkflow,
  useDeleteDefinitionItem,
  useMarketplace,
  useStateCounts,
  useWorkflowGraph,
  useWorkflows,
} from '@/lib/marketplace/provider';
import { useQueries } from '@tanstack/react-query';
import { useHost, useHostKey } from '@/lib/marketplace/provider';
import { parseMessage, ASSISTANT_SUGGESTIONS } from '@/lib/assistant/engine';
import type {
  AssistantConversation,
  AssistantContext,
  AssistantEmbed,
  AssistantProposal,
  ChatMessage,
} from '@/lib/assistant/types';
import type { WorkflowGraph } from '@/lib/workflow/types';

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `m${msgCounter}`;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Hi, I’m FLO — your WorkFLO guide. I can help you prioritize inbox work, understand workflow actions, use AI quality checks, assign content, and manage workflow definitions. I’ll always show you a proposal before I make a definition change.',
  embed: { kind: 'capabilities' },
};

/**
 * Floating conversational assistant.
 *
 * Safety model: the parser only produces structured proposals mapped to
 * the host mutations this app already exposes; each proposal renders as
 * a review card and NOTHING is sent to Sitecore until the user clicks
 * the explicit confirm button on that card. The whole panel lives under
 * the host-generation remount, so demo-era conversations and pending
 * proposals are dropped on a demo → live handoff.
 */
export function ChatPanel({ className, onClose }: { className?: string; onClose?: () => void }) {
  const workflows = useWorkflows();
  const host = useHost();
  const hostKey = useHostKey();
  const { status } = useMarketplace();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [conversation, setConversation] = useState<AssistantConversation>({});
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Preload every definition graph so the parser can resolve transitions.
  const graphQueries = useQueries({
    queries: (workflows.data ?? []).map((wf) => ({
      queryKey: ['workflow-graph', wf.workflowId, hostKey],
      queryFn: () => host.getWorkflowGraph(wf.workflowId),
    })),
  });
  const graphs = useMemo(() => {
    const out: Record<string, WorkflowGraph> = {};
    (workflows.data ?? []).forEach((wf, i) => {
      const g = graphQueries[i]?.data;
      if (g) out[wf.workflowId] = g;
    });
    return out;
  }, [workflows.data, graphQueries]);

  const ctx: AssistantContext = useMemo(
    () => ({ workflows: workflows.data ?? [], graphs }),
    [workflows.data, graphs],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const send = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || thinking) return;
    setInput('');
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setThinking(true);
    // Small delay so the reply feels conversational rather than instant flicker.
    window.setTimeout(() => {
      const reply = parseMessage(text, ctx, conversation);
      if (reply.conversation) {
        setConversation(reply.conversation);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: reply.text,
          embed: reply.embed,
          proposal: reply.proposal,
          proposalStatus: reply.proposal ? 'pending' : undefined,
          warnings: reply.warnings,
        },
      ]);
      setThinking(false);
    }, 250);
  };

  const patchMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="panel-assistant">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FLOAvatar className="size-7" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">FLO</p>
          <p className="truncate text-xs text-muted-foreground">
            {status.state === 'live'
              ? 'Your guide to live Sitecore workflows'
              : 'Exploring demo data with you — changes stay local'}
          </p>
        </div>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={onClose}
            aria-label="Close FLO"
            data-testid="button-hide-assistant"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {messages.map((m) => (
            <Message key={m.id} message={m} onPatch={patchMessage} onSuggest={send} />
          ))}
          {thinking && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-3">
        {messages.length <= 1 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {ASSISTANT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                data-testid={`chip-suggestion-${s.slice(0, 12)}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask about your workflow work…"
            className="max-h-32 min-h-9 flex-1 resize-none"
            data-testid="input-assistant"
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0"
            disabled={!input.trim() || thinking}
            aria-label="Send"
            data-testid="button-assistant-send"
          >
            <Send className="size-4" />
          </Button>
        </form>
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          AI review is advisory. Workflow definition changes require your confirmation.
        </p>
      </div>
    </div>
  );
}

function Message({
  message,
  onPatch,
  onSuggest,
}: {
  message: ChatMessage;
  onPatch: (id: string, patch: Partial<ChatMessage>) => void;
  onSuggest: (text: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-inverse-text"
          data-testid="message-user"
        >
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <FLOAvatar className="mt-0.5 size-6" />
      <div className="min-w-0 max-w-[90%] flex-1 space-y-2">
        <div
          className="whitespace-pre-line rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2 text-sm text-foreground"
          data-testid="message-assistant"
        >
          {message.text}
        </div>
        {message.warnings?.map((w, i) => (
          <Alert key={i} className="py-2">
            <AlertDescription className="text-xs">{w}</AlertDescription>
          </Alert>
        ))}
        {message.embed && <Embed embed={message.embed} onSuggest={onSuggest} />}
        {message.proposal && <ProposalCard message={message} onPatch={onPatch} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Embeds                                                              */
/* ------------------------------------------------------------------ */

function Embed({ embed, onSuggest }: { embed: AssistantEmbed; onSuggest: (t: string) => void }) {
  switch (embed.kind) {
    case 'capabilities':
      return null;
    case 'workflow-list':
      return <WorkflowListEmbed onSuggest={onSuggest} />;
    case 'workflow-overview':
      return <WorkflowOverviewEmbed workflowId={embed.workflowId} />;
    case 'state-queue':
      return (
        <EmbedShell>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{embed.stateName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{embed.workflowName}</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/workflows/${encodeURIComponent(embed.workflowId)}/states/${encodeURIComponent(embed.stateId)}`}
              >
                Open queue <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </EmbedShell>
      );
  }
}

function EmbedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-neutral-bg/40 p-3" data-testid="assistant-embed">
      {children}
    </div>
  );
}

function WorkflowListEmbed({ onSuggest }: { onSuggest: (t: string) => void }) {
  const workflows = useWorkflows();
  if (!workflows.data || workflows.data.length === 0) return null;
  return (
    <EmbedShell>
      <ul className="space-y-1.5">
        {workflows.data.map((wf) => (
          <li key={wf.workflowId} className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-left text-xs font-medium text-foreground hover:text-primary"
              onClick={() => onSuggest(`Explain the ${wf.displayName} workflow`)}
            >
              {wf.displayName}
            </button>
            <span className="flex shrink-0 items-center gap-1.5">
              <Badge colorScheme="neutral" className="text-[10px]">
                {wf.states.length} states
              </Badge>
              <Button asChild size="sm" variant="ghost" className="h-6 px-1.5">
                <Link href={`/workflows/${encodeURIComponent(wf.workflowId)}`}>
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </EmbedShell>
  );
}

function WorkflowOverviewEmbed({ workflowId }: { workflowId: string }) {
  const graph = useWorkflowGraph(workflowId);
  const stateIds = useMemo(
    () => graph.data?.states.map((s) => s.stateId) ?? [],
    [graph.data],
  );
  const counts = useStateCounts(workflowId, stateIds);
  if (!graph.data) return null;
  return (
    <EmbedShell>
      <WorkflowCanvas graph={graph.data} countsByState={counts.data} className="border-0 bg-transparent" />
      <div className="mt-2 flex justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={`/workflows/${encodeURIComponent(workflowId)}`}>
            Manage <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </EmbedShell>
  );
}

/* ------------------------------------------------------------------ */
/* Proposal card — the ONLY path from assistant intent to a mutation.  */
/* ------------------------------------------------------------------ */

function ProposalCard({
  message,
  onPatch,
}: {
  message: ChatMessage;
  onPatch: (id: string, patch: Partial<ChatMessage>) => void;
}) {
  const proposal = message.proposal!;
  const status = message.proposalStatus ?? 'pending';
  const host = useHost();
  const createWorkflow = useCreateWorkflow();
  const addState = useAddState();
  const addTransition = useAddTransition();
  const deleteItem = useDeleteDefinitionItem();
  const busy =
    createWorkflow.isPending || addState.isPending || addTransition.isPending || deleteItem.isPending;

  const apply = async () => {
    const done = (result: string) =>
      onPatch(message.id, { proposalStatus: 'applied', proposalResult: result });
    const failed = (error: unknown) =>
      onPatch(message.id, {
        proposalStatus: 'failed',
        proposalResult: error instanceof Error ? error.message : 'The change failed.',
      });
    // Fail-closed revalidation: proposals can go stale if the definition
    // changed after they were drafted, so re-check the live graph right
    // before mutating and refuse on any mismatch.
    if (proposal.kind !== 'create-workflow') {
      try {
        const fresh = await host.getWorkflowGraph(proposal.workflowId);
        if (proposal.kind === 'add-state') {
          if (fresh.states.some((s) => s.displayName.trim().toLowerCase() === proposal.stateName.trim().toLowerCase())) {
            failed(new Error(`"${proposal.workflowName}" now already has a state named "${proposal.stateName}". Ask again to get a fresh proposal.`));
            return;
          }
        } else if (proposal.kind === 'add-transition') {
          const fromOk = fresh.states.some((s) => s.stateId === proposal.fromStateId);
          const toOk = fresh.states.some((s) => s.stateId === proposal.toStateId);
          if (!fromOk || !toOk) {
            failed(new Error('The workflow changed since this proposal was drafted — one of the states no longer exists. Ask again to get a fresh proposal.'));
            return;
          }
        } else if (proposal.kind === 'delete-transition') {
          const target = fresh.transitions.find((t) => t.commandId === proposal.commandId);
          if (!target || target.displayName.trim().toLowerCase() !== proposal.commandName.trim().toLowerCase()) {
            failed(new Error('The workflow changed since this proposal was drafted — that transition no longer matches. Ask again to get a fresh proposal.'));
            return;
          }
        }
      } catch (error) {
        failed(error instanceof Error ? error : new Error('Could not re-check the workflow before applying.'));
        return;
      }
    }
    switch (proposal.kind) {
      case 'create-workflow':
        createWorkflow.mutate(proposal.spec, {
          onSuccess: () => done(`Workflow "${proposal.spec.name}" created.`),
          onError: failed,
        });
        break;
      case 'add-state':
        addState.mutate(
          { workflowId: proposal.workflowId, name: proposal.stateName, final: proposal.final },
          {
            onSuccess: () => done(`State "${proposal.stateName}" added to ${proposal.workflowName}.`),
            onError: failed,
          },
        );
        break;
      case 'add-transition':
        addTransition.mutate(
          {
            fromStateId: proposal.fromStateId,
            name: proposal.commandName,
            toStateId: proposal.toStateId,
          },
          {
            onSuccess: () => done(`Transition "${proposal.commandName}" added.`),
            onError: failed,
          },
        );
        break;
      case 'delete-transition':
        deleteItem.mutate(
          { itemId: proposal.commandId },
          {
            onSuccess: () =>
              done(`Transition "${proposal.commandName}" moved to the Sitecore recycle bin.`),
            onError: failed,
          },
        );
        break;
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        status === 'applied'
          ? 'border-success-fg/30 bg-success-bg/40'
          : status === 'failed'
            ? 'border-destructive/40 bg-destructive/5'
            : status === 'cancelled'
              ? 'border-border bg-neutral-bg/40 opacity-70'
              : 'border-primary/40 bg-card shadow-sm',
      )}
      data-testid={`proposal-${proposal.kind}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge colorScheme={status === 'applied' ? 'success' : status === 'failed' ? 'danger' : 'primary'}>
          {status === 'pending' ? 'Proposed change' : status === 'applied' ? 'Applied' : status === 'failed' ? 'Failed' : 'Dismissed'}
        </Badge>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {labelFor(proposal)}
        </span>
      </div>

      <ProposalDetails proposal={proposal} />

      {status === 'pending' && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onPatch(message.id, { proposalStatus: 'cancelled' })}
            data-testid="button-proposal-dismiss"
          >
            <X className="size-3.5" /> Dismiss
          </Button>
          <Button size="sm" disabled={busy} onClick={apply} data-testid="button-proposal-apply">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {busy ? 'Applying…' : 'Confirm & apply'}
          </Button>
        </div>
      )}
      {message.proposalResult && (
        <p
          className={cn(
            'mt-2 text-xs',
            status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
          data-testid="text-proposal-result"
        >
          {message.proposalResult}
        </p>
      )}
    </div>
  );
}

function labelFor(p: AssistantProposal): string {
  switch (p.kind) {
    case 'create-workflow':
      return 'Create workflow';
    case 'add-state':
      return 'Add state';
    case 'add-transition':
      return 'Add transition';
    case 'delete-transition':
      return 'Delete transition';
  }
}

function ProposalDetails({ proposal }: { proposal: AssistantProposal }) {
  switch (proposal.kind) {
    case 'create-workflow': {
      const graph: WorkflowGraph = {
        workflowId: 'proposal',
        states: proposal.spec.states.map((s) => ({
          stateId: s.key,
          displayName: s.name,
          initial: s.initial,
          final: s.final,
        })),
        transitions: proposal.spec.transitions.map((t, i) => ({
          commandId: `p${i}`,
          displayName: t.name,
          fromStateId: t.fromKey,
          toStateId: t.toKey,
        })),
      };
      return (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{proposal.spec.name}</p>
          <WorkflowCanvas graph={graph} />
        </div>
      );
    }
    case 'add-state':
      return (
        <p className="text-sm text-foreground">
          Add {proposal.final ? <>final state</> : <>state</>}{' '}
          <span className="font-semibold">“{proposal.stateName}”</span> to{' '}
          <span className="font-semibold">{proposal.workflowName}</span>.
        </p>
      );
    case 'add-transition':
      return (
        <p className="text-sm text-foreground">
          In <span className="font-semibold">{proposal.workflowName}</span>: add command{' '}
          <span className="font-semibold">“{proposal.commandName}”</span> moving items{' '}
          <span className="font-semibold">{proposal.fromStateName}</span> →{' '}
          <span className="font-semibold">{proposal.toStateName}</span>.
        </p>
      );
    case 'delete-transition':
      return (
        <p className="text-sm text-foreground">
          Delete <span className="font-semibold">“{proposal.commandName}”</span> (
          {proposal.fromStateName} → {proposal.toStateName}) from{' '}
          <span className="font-semibold">{proposal.workflowName}</span>. Restorable from the
          Sitecore recycle bin.
        </p>
      );
  }
}
