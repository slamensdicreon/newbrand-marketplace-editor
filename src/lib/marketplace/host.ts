import type {
  AssignmentResult,
  CommandResult,
  ContentItem,
  DraftWorkflowSpec,
  ExecuteCommandArgs,
  QueuePage,
  StateCounts,
  WorkflowCommandInfo,
  WorkflowGraph,
  WorkflowHistoryEvent,
  WorkflowInfo,
} from '@/lib/workflow/types';

/** Who is signed in to SitecoreAI (comes from the Marketplace host). */
export interface EditorUser {
  name: string;
  email?: string;
}

/**
 * Abstraction over the surface this app needs from its host:
 * - who the signed-in editor is,
 * - reading and operating Sitecore workflows,
 * - browsing content and assigning workflows.
 *
 * Two implementations exist:
 * - `SdkMarketplaceHost` — real, host-mediated calls through the Sitecore
 *   Marketplace SDK when the app runs inside SitecoreAI.
 * - `MockMarketplaceHost` — in-memory demo data for local preview, where no
 *   Marketplace host exists.
 */
export interface MarketplaceHost {
  readonly mode: 'live' | 'demo';
  getUser(): Promise<EditorUser>;

  /* ---- Workflow operations (command center + starter builder) ---- */

  /** All workflow definitions with their states. */
  listWorkflows(): Promise<WorkflowInfo[]>;
  /** Items-per-state counts for one workflow. */
  getStateCounts(workflowId: string, stateIds: string[]): Promise<StateCounts>;
  /** One page of items sitting in a workflow state. */
  getQueue(workflowId: string, stateId: string, after?: string | null): Promise<QueuePage>;
  /** Commands editors may trigger from a state. */
  getStateCommands(workflowId: string, stateId: string): Promise<WorkflowCommandInfo[]>;
  /** Workflow history for one item. */
  getItemHistory(workflowId: string, itemId: string, language: string): Promise<WorkflowHistoryEvent[]>;
  /** Execute a workflow command against one item version. */
  executeCommand(args: ExecuteCommandArgs): Promise<CommandResult>;
  /**
   * Create a new draft workflow definition (workflow, states, transition
   * commands) under /sitecore/system/Workflows. Returns the new workflow id.
   */
  createDraftWorkflow(spec: DraftWorkflowSpec): Promise<{ workflowId: string }>;

  /* ---- Definition management (verified operations only) ----
   * The Authoring API exposes createItem and deleteItem for the regular
   * items that make up a workflow definition. deleteItem without
   * `permanently` moves items to the Sitecore recycle bin, so it is
   * recoverable in native tools. There is NO API for renaming, reordering
   * states, or configuring workflow actions — those stay in native Sitecore
   * tools and this interface deliberately has no methods for them. */

  /** Full definition graph (states + transition edges) for one workflow. */
  getWorkflowGraph(workflowId: string): Promise<WorkflowGraph>;
  /** Add a state item to an existing workflow. Returns the new state id. */
  addState(workflowId: string, name: string, final: boolean): Promise<{ stateId: string }>;
  /** Add a transition command under a source state pointing at a target state. */
  addTransition(
    fromStateId: string,
    name: string,
    toStateId: string,
  ): Promise<{ commandId: string }>;
  /**
   * Move one definition item (workflow, state or command) to the Sitecore
   * recycle bin. Never deletes permanently.
   */
  deleteDefinitionItem(itemId: string): Promise<void>;

  /* ---- Content browsing & workflow assignment ----
   * Assignment writes the standard `__Workflow` / `__Workflow state`
   * fields through the verified updateItem mutation, one explicit item at
   * a time. There is deliberately no "assign to subtree" operation. */

  /**
   * Children of one content item (or the site content root when null),
   * with workflow metadata for the assignment browser.
   */
  getContentChildren(parentId: string | null): Promise<ContentItem[]>;
  /**
   * Fresh lookup of specific items by id, used to re-resolve a selection
   * immediately before assignment. Missing items are simply omitted.
   */
  getContentItems(itemIds: string[]): Promise<ContentItem[]>;
  /**
   * Assign a workflow (placing each item in the workflow's initial state)
   * to an explicit, bounded set of items. Returns per-item results and
   * never retries or widens the selection.
   */
  assignWorkflow(items: ContentItem[], workflowId: string): Promise<AssignmentResult[]>;

  /** Release any resources (subscriptions, ports). */
  destroy(): void;
}

export class HostUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostUnavailableError';
  }
}

/**
 * Domains we accept as a Marketplace host, matched as exact hostname or any
 * subdomain, HTTPS only. The first three are the official trusted domains
 * baked into the Sitecore Marketplace SDK's own handshake validation
 * (its `AllowedOrigins` list), which covers SitecoreAI / Cloud Portal
 * surfaces; the last two cover Sitecore's first-party product domains.
 * The SDK performs its own handshake against `window.parent`; we
 * additionally refuse to even attempt a handshake when the embedding
 * document's origin is known and is not one of these.
 */
const TRUSTED_HOST_DOMAINS = [
  'sitecorecloud.io',
  'sitecorecloud.app',
  'sitecore-staging.cloud',
  'sitecore.io',
  'sitecore.com',
];

/**
 * Decide whether an embedding origin may act as the Marketplace host.
 * Accepts an origin or full URL (e.g. document.referrer).
 * Returns the normalized origin when allowed, otherwise null.
 */
export function resolveAllowedHostOrigin(originOrUrl: string): string | null {
  if (!originOrUrl) return null;
  let url: URL;
  try {
    url = new URL(originOrUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const hostname = url.hostname.toLowerCase();
  const allowed = TRUSTED_HOST_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith('.' + domain),
  );
  return allowed ? url.origin : null;
}

/**
 * Best-effort detection of the embedding page's origin. Browsers vary:
 * - Chromium/WebKit expose `location.ancestorOrigins` (authoritative).
 * - Otherwise fall back to `document.referrer`, which the embedding page's
 *   Referrer-Policy may strip entirely.
 * Returns the origin string, or null when it cannot be determined.
 */
export function detectEmbeddingOrigin(
  loc: Pick<Location, 'ancestorOrigins'> = window.location,
  referrer: string = document.referrer,
): string | null {
  try {
    // Per the HTML spec, ancestorOrigins is ordered from the *nearest*
    // ancestor (the immediate parent — the frame ClientSDK.init targets via
    // window.parent) at index 0, to the top-level browsing context last.
    // Index 0 is therefore exactly the origin the handshake must be pinned to,
    // even in nested embeddings (e.g. portal shell > SitecoreAI > this app).
    const ancestor = loc.ancestorOrigins?.[0];
    if (ancestor && ancestor !== 'null') return ancestor;
  } catch {
    // Some engines do not implement ancestorOrigins.
  }
  if (referrer) {
    try {
      return new URL(referrer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/** True when this document is embedded in another frame. */
export function isEmbedded(win: Pick<Window, 'self' | 'top'>): boolean {
  try {
    return win.self !== win.top;
  } catch {
    // Cross-origin access to window.top throws — which means we ARE framed.
    return true;
  }
}
