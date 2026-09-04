import type {
  DraftWorkflowSpec,
  WorkflowGraph,
  WorkflowInfo,
} from '@/lib/workflow/types';

/**
 * Assistant domain model.
 *
 * The assistant is deliberately CONSTRAINED: it can only produce
 * (a) informational replies built from real Marketplace-host data, and
 * (b) structured `AssistantProposal`s that map 1:1 onto the host
 *     mutations the app already exposes. It never invents Sitecore
 *     command ids — proposals carry *names*, and the proposal card
 *     resolves them against live host data before the user can confirm.
 * Nothing mutates Sitecore until the user explicitly confirms a
 * proposal card.
 */

/** Everything the parser is allowed to know. All of it comes from host queries. */
export interface AssistantContext {
  workflows: WorkflowInfo[];
  /** Definition graphs keyed by workflowId (loaded lazily; may be partial). */
  graphs: Record<string, WorkflowGraph>;
}

/**
 * Small, client-only conversational memory. It contains only resolved
 * workflow ids and candidate ids already returned from the current host;
 * it never stores an invented target or a mutation request. ChatPanel is
 * remounted with the host generation, so this state cannot cross demo/live.
 */
export interface AssistantConversation {
  selectedWorkflowId?: string;
  awaitingWorkflowIds?: string[];
  /**
   * In-progress guided "build a workflow" conversation. Holds only the
   * names the user has typed so far; nothing is created until the resulting
   * proposal card is confirmed.
   */
  creating?: GuidedCreateDraft;
}

export interface GuidedCreateDraft {
  step: 'name' | 'states' | 'reject';
  name?: string;
  states?: string[];
}

export type AssistantProposal =
  | {
      kind: 'create-workflow';
      spec: DraftWorkflowSpec;
    }
  | {
      kind: 'add-state';
      workflowId: string;
      workflowName: string;
      stateName: string;
      final: boolean;
    }
  | {
      kind: 'add-transition';
      workflowId: string;
      workflowName: string;
      commandName: string;
      fromStateId: string;
      fromStateName: string;
      toStateId: string;
      toStateName: string;
    }
  | {
      kind: 'delete-transition';
      workflowId: string;
      workflowName: string;
      commandId: string;
      commandName: string;
      fromStateName: string;
      toStateName: string;
    };

export type AssistantEmbed =
  | { kind: 'workflow-overview'; workflowId: string }
  | { kind: 'workflow-list' }
  | { kind: 'state-queue'; workflowId: string; stateId: string; stateName: string; workflowName: string }
  | { kind: 'capabilities' };

export interface AssistantReply {
  /** Markdown-free plain text; keep it short and factual. */
  text: string;
  embed?: AssistantEmbed;
  proposal?: AssistantProposal;
  /** Non-blocking caveats shown with the reply. */
  warnings?: string[];
  /** Updated only from workflow ids resolved against the current host. */
  conversation?: AssistantConversation;
}

export type ProposalStatus = 'pending' | 'applied' | 'cancelled' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  embed?: AssistantEmbed;
  proposal?: AssistantProposal;
  proposalStatus?: ProposalStatus;
  proposalResult?: string;
  warnings?: string[];
}
