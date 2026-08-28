/**
 * Workflow domain model for the command center and starter builder.
 *
 * Everything here mirrors what the XM Cloud Authoring GraphQL schema
 * actually exposes (verified against the live environment):
 * - `workflows` / `workflow` queries with states, per-state commands,
 *   `itemsCount(stateId)`, `items(stateId)` queues and per-item `history`;
 * - `executeWorkflowCommand` and `startWorkflow` mutations;
 * - workflow *definitions* are regular items under /sitecore/system/Workflows,
 *   so a basic builder can create draft flows with `createItem`.
 * There is no schema support for deleting/reordering states or editing
 * workflow actions — those stay in native Sitecore tools by design.
 */

export interface WorkflowStateInfo {
  stateId: string;
  displayName: string;
  /** Terminal state (e.g. Approved). */
  final: boolean;
  /** True when this is the workflow's initial state. */
  initial: boolean;
}

export interface WorkflowInfo {
  workflowId: string;
  displayName: string;
  states: WorkflowStateInfo[];
}

/** Items-per-state counts for one workflow, keyed by normalized state id. */
export type StateCounts = Record<string, number>;

export interface WorkflowCommandInfo {
  commandId: string;
  displayName: string;
  /** When true, Sitecore hides the comment box for this command. */
  suppressComments: boolean;
}

export interface QueueItem {
  itemId: string;
  name: string;
  path: string;
  language: string;
  version: number | null;
  /** ISO date string when the item version was last updated, if known. */
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface QueuePage {
  items: QueueItem[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface WorkflowHistoryEvent {
  date: string | null;
  user: string | null;
  oldState: string | null;
  newState: string | null;
  comments: string[];
}

export interface CommandResult {
  completed: boolean;
  successful: boolean;
  error: string | null;
  message: string | null;
  nextStateId: string | null;
}

export interface ExecuteCommandArgs {
  itemId: string;
  language: string;
  version: number | null;
  commandId: string;
  comments?: string;
}

/** One transition command edge in a workflow definition graph. */
export interface WorkflowTransitionInfo {
  commandId: string;
  displayName: string;
  fromStateId: string;
  /** Null when the command has no "Next state" set (stays in place). */
  toStateId: string | null;
}

/** Full definition graph for one workflow: states plus transition edges. */
export interface WorkflowGraph {
  workflowId: string;
  states: WorkflowStateInfo[];
  transitions: WorkflowTransitionInfo[];
}

/* ------------------------------------------------------------------ */
/* Content browsing & workflow assignment                              */
/* ------------------------------------------------------------------ */

/** Coarse item kind derived from the template, for browsing/filtering. */
export type ContentItemKind = 'page' | 'folder' | 'component' | 'other';

/** One Sitecore content item as shown in the assignment browser. */
export interface ContentItem {
  itemId: string;
  name: string;
  path: string;
  templateName: string;
  kind: ContentItemKind;
  hasChildren: boolean;
  language: string;
  version: number | null;
  /** Workflow currently governing the item, if any. */
  workflow: { workflowId: string; displayName: string } | null;
  /** Current workflow state of the item, if any. */
  workflowState: { stateId: string; displayName: string } | null;
}

/** Per-item outcome of a workflow assignment. Never aggregated away. */
export interface AssignmentResult {
  itemId: string;
  name: string;
  path: string;
  successful: boolean;
  error: string | null;
}

/**
 * Hard ceiling on how many items one assignment may target. There is
 * deliberately no "apply to everything" — selection is always an explicit,
 * bounded set.
 */
export const MAX_ASSIGN_SELECTION = 25;
/** Hard ceiling for an explicit inbox command batch. */
export const MAX_BULK_SELECTION = 25;

/** Classify a Sitecore template name into a coarse browsing kind. */
export function classifyTemplate(templateName: string): ContentItemKind {
  const name = templateName.toLowerCase();
  if (/folder/.test(name)) return 'folder';
  if (/page|route|home|landing/.test(name)) return 'page';
  if (/rendering|component|datasource|hero|banner|rail|dock|section|text|image|promo|card/.test(name)) {
    return 'component';
  }
  return 'other';
}

/**
 * Validate a proposed selection against the bounded-selection rules.
 * Returns human-readable problems; empty means the selection may proceed.
 */
export function validateSelection(itemIds: string[]): string[] {
  const problems: string[] = [];
  if (itemIds.length === 0) problems.push('Select at least one item.');
  if (itemIds.length > MAX_ASSIGN_SELECTION) {
    problems.push(
      `Too many items selected (${itemIds.length}). Apply to at most ${MAX_ASSIGN_SELECTION} items at a time.`,
    );
  }
  const seen = new Set<string>();
  for (const id of itemIds) {
    const norm = normalizeId(id);
    if (seen.has(norm)) problems.push('The selection contains duplicate items.');
    seen.add(norm);
  }
  return problems;
}

/**
 * Resolve a selection against FRESH host data immediately before applying.
 * Items no longer present resolve as stale failures; nothing is widened,
 * substituted or retried.
 */
export function resolveAssignmentTargets(
  selectedIds: string[],
  freshItems: ContentItem[],
): { resolved: ContentItem[]; stale: string[] } {
  const byId = new Map(freshItems.map((i) => [normalizeId(i.itemId), i] as const));
  const resolved: ContentItem[] = [];
  const stale: string[] = [];
  for (const id of selectedIds) {
    const item = byId.get(normalizeId(id));
    if (item) resolved.push(item);
    else stale.push(normalizeId(id));
  }
  return { resolved, stale };
}

/* ------------------------------------------------------------------ */
/* Draft workflow builder                                              */
/* ------------------------------------------------------------------ */

export interface DraftState {
  /** Client-side key, stable while editing. */
  key: string;
  name: string;
  initial: boolean;
  final: boolean;
}

export interface DraftTransition {
  /** Command name shown to editors (e.g. "Submit"). */
  name: string;
  /** DraftState.key of the source state. */
  fromKey: string;
  /** DraftState.key of the target state. */
  toKey: string;
}

export interface DraftWorkflowSpec {
  name: string;
  states: DraftState[];
  transitions: DraftTransition[];
}

const ITEM_NAME_RE = /^[\w][\w .\-]*$/;

/** Validate a draft workflow. Returns a list of human-readable problems. */
export function validateDraftWorkflow(spec: DraftWorkflowSpec): string[] {
  const problems: string[] = [];
  const name = spec.name.trim();
  if (!name) {
    problems.push('Give the workflow a name.');
  } else if (!ITEM_NAME_RE.test(name)) {
    problems.push(
      'The workflow name may only use letters, numbers, spaces, dots, hyphens and underscores.',
    );
  }
  if (spec.states.length < 2) {
    problems.push('Add at least two states (for example Draft and Approved).');
  }
  const seen = new Set<string>();
  for (const state of spec.states) {
    const stateName = state.name.trim();
    if (!stateName) {
      problems.push('Every state needs a name.');
      continue;
    }
    if (!ITEM_NAME_RE.test(stateName)) {
      problems.push(
        `State "${stateName}" may only use letters, numbers, spaces, dots, hyphens and underscores.`,
      );
    }
    const lower = stateName.toLowerCase();
    if (seen.has(lower)) {
      problems.push(`State names must be unique — "${stateName}" appears more than once.`);
    }
    seen.add(lower);
  }
  const initialCount = spec.states.filter((s) => s.initial).length;
  if (initialCount !== 1) {
    problems.push('Exactly one state must be marked as the initial state.');
  }
  if (spec.states.some((s) => s.initial && s.final)) {
    problems.push('The initial state cannot also be a final state.');
  }
  const keys = new Set(spec.states.map((s) => s.key));
  const transitionNames = new Map<string, Set<string>>();
  for (const t of spec.transitions) {
    const tName = t.name.trim();
    if (!tName) {
      problems.push('Every transition needs a command name (for example "Submit").');
    } else if (!ITEM_NAME_RE.test(tName)) {
      problems.push(
        `Transition "${tName}" may only use letters, numbers, spaces, dots, hyphens and underscores.`,
      );
    }
    if (!keys.has(t.fromKey) || !keys.has(t.toKey)) {
      problems.push(`Transition "${tName || '(unnamed)'}" points at a state that no longer exists.`);
      continue;
    }
    if (t.fromKey === t.toKey) {
      problems.push(`Transition "${tName || '(unnamed)'}" must move to a different state.`);
    }
    const perState = transitionNames.get(t.fromKey) ?? new Set<string>();
    const lower = tName.toLowerCase();
    if (lower && perState.has(lower)) {
      problems.push(`State has two transitions named "${tName}" — command names must be unique per state.`);
    }
    perState.add(lower);
    transitionNames.set(t.fromKey, perState);
  }
  if (spec.transitions.length === 0) {
    problems.push('Add at least one transition between states.');
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Aging / bottleneck thresholds (visible in the UI, not hidden SLAs)  */
/* ------------------------------------------------------------------ */

/** Items older than this (days) in a non-final state count as "aging". */
export const AGING_DAYS = 2;
/** Items older than this (days) in a non-final state count as "stale". */
export const STALE_DAYS = 7;

export type AgeBucket = 'fresh' | 'aging' | 'stale' | 'unknown';

export function ageBucket(updatedAt: string | null, now: Date = new Date()): AgeBucket {
  if (!updatedAt) return 'unknown';
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return 'unknown';
  const days = (now.getTime() - updated.getTime()) / 86_400_000;
  if (days >= STALE_DAYS) return 'stale';
  if (days >= AGING_DAYS) return 'aging';
  return 'fresh';
}

export function formatAge(updatedAt: string | null, now: Date = new Date()): string {
  if (!updatedAt) return 'unknown age';
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return 'unknown age';
  const ms = Math.max(0, now.getTime() - updated.getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ------------------------------------------------------------------ */
/* Sitecore value parsing helpers                                      */
/* ------------------------------------------------------------------ */

/** Normalize a Sitecore id ("{A-B}" or bare hex) to uppercase braced form. */
export function normalizeId(id: string): string {
  const hex = id.replace(/[{}\-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) return id.toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

/** Parse a Sitecore ISO date field value like "20260823T134000Z". */
export function parseSitecoreDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
  if (!m) {
    const asIs = new Date(value);
    return Number.isNaN(asIs.getTime()) ? null : asIs.toISOString();
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || 'Z'}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
