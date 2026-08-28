import { layoutWorkflow } from './layout';
import type { DraftState, DraftTransition, DraftWorkflowSpec, WorkflowGraph } from './types';

/**
 * Pure interaction model for the drag-and-drop workflow builder.
 *
 * The draft keeps the exact same DraftState/DraftTransition shapes that the
 * host's createDraftWorkflow mutation consumes — node positions are a purely
 * client-side visual concern layered on top (keyed by DraftState.key) and are
 * never part of the Sitecore payload.
 */

export interface NodePosition {
  x: number;
  y: number;
}

export interface BuilderDraft {
  states: DraftState[];
  transitions: DraftTransition[];
  /** Canvas position per DraftState.key. */
  positions: Record<string, NodePosition>;
}

/** Node box size used for default placement and overlap avoidance. */
export const NODE_W = 176;
export const NODE_H = 72;
const GAP_X = 96;
const GAP_Y = 40;
const PAD = 16;

let keyCounter = 0;
/** Stable, unique client-side key for a new draft state. */
export function nextStateKey(): string {
  keyCounter += 1;
  return `s${keyCounter}`;
}

/** Grid-position a draft using the same layered layout as the read-only diagram. */
export function autoPositions(
  states: DraftState[],
  transitions: DraftTransition[],
): Record<string, NodePosition> {
  const graph: WorkflowGraph = {
    workflowId: 'draft',
    states: states.map((s) => ({
      stateId: s.key,
      displayName: s.name,
      initial: s.initial,
      final: s.final,
    })),
    transitions: transitions.map((t, i) => ({
      commandId: `t${i}`,
      displayName: t.name,
      fromStateId: t.fromKey,
      toStateId: t.toKey,
    })),
  };
  const layout = layoutWorkflow(graph);
  const positions: Record<string, NodePosition> = {};
  for (const n of layout.nodes) {
    positions[n.stateId] = {
      x: PAD + n.col * (NODE_W + GAP_X),
      y: PAD + n.row * (NODE_H + GAP_Y),
    };
  }
  return positions;
}

/** Start with a blank canvas; editors add only the states their flow needs. */
export function defaultDraft(): BuilderDraft {
  return { states: [], transitions: [], positions: {} };
}

/** Find a free spot that does not overlap an existing node. */
export function findFreePosition(draft: BuilderDraft): NodePosition {
  const taken = Object.values(draft.positions);
  const overlaps = (p: NodePosition) =>
    taken.some((q) => Math.abs(q.x - p.x) < NODE_W + 24 && Math.abs(q.y - p.y) < NODE_H + 16);
  // Scan a coarse grid left→right, top→bottom.
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 8; col++) {
      const p = { x: PAD + col * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) };
      if (!overlaps(p)) return p;
    }
  }
  // Everything full (absurd) — stack below the lowest node.
  const maxY = Math.max(0, ...taken.map((p) => p.y));
  return { x: PAD, y: maxY + NODE_H + GAP_Y };
}

/** Add a state at the given position (or the next free spot). */
export function addState(draft: BuilderDraft, at?: NodePosition): { draft: BuilderDraft; key: string } {
  const key = nextStateKey();
  const pos = at ?? findFreePosition(draft);
  return {
    key,
    draft: {
      states: [...draft.states, { key, name: '', initial: false, final: false }],
      transitions: draft.transitions,
      positions: { ...draft.positions, [key]: { x: Math.max(0, pos.x), y: Math.max(0, pos.y) } },
    },
  };
}

/** Move a state node; coordinates are clamped to the canvas origin. */
export function moveState(draft: BuilderDraft, key: string, to: NodePosition): BuilderDraft {
  if (!draft.states.some((s) => s.key === key)) return draft;
  return {
    ...draft,
    positions: {
      ...draft.positions,
      [key]: { x: Math.max(0, Math.round(to.x)), y: Math.max(0, Math.round(to.y)) },
    },
  };
}

/** Patch a state; marking one initial clears the flag on all others. */
export function updateState(
  draft: BuilderDraft,
  key: string,
  patch: Partial<Omit<DraftState, 'key'>>,
): BuilderDraft {
  return {
    ...draft,
    states: draft.states.map((s) => {
      if (s.key !== key) return patch.initial ? { ...s, initial: false } : s;
      return { ...s, ...patch };
    }),
  };
}

/** Remove a state, its position, and every transition touching it. */
export function removeState(draft: BuilderDraft, key: string): BuilderDraft {
  const positions = { ...draft.positions };
  delete positions[key];
  return {
    states: draft.states.filter((s) => s.key !== key),
    transitions: draft.transitions.filter((t) => t.fromKey !== key && t.toKey !== key),
    positions,
  };
}

/**
 * Why a connection between two states is not allowed right now, or null
 * when it is. Used both for drop feedback and to guard connectStates.
 */
export function connectionProblem(draft: BuilderDraft, fromKey: string, toKey: string): string | null {
  if (fromKey === toKey) return 'A transition must move to a different state.';
  if (!draft.states.some((s) => s.key === fromKey) || !draft.states.some((s) => s.key === toKey)) {
    return 'Both states must exist.';
  }
  if (draft.transitions.some((t) => t.fromKey === fromKey && t.toKey === toKey)) {
    return 'These states are already connected in this direction.';
  }
  return null;
}

/** Create a transition between two states. Returns the unchanged draft on invalid connections. */
export function connectStates(
  draft: BuilderDraft,
  fromKey: string,
  toKey: string,
  name = '',
): { draft: BuilderDraft; index: number; problem: string | null } {
  const problem = connectionProblem(draft, fromKey, toKey);
  if (problem) return { draft, index: -1, problem };
  return {
    draft: { ...draft, transitions: [...draft.transitions, { name, fromKey, toKey }] },
    index: draft.transitions.length,
    problem: null,
  };
}

export function updateTransition(
  draft: BuilderDraft,
  index: number,
  patch: Partial<DraftTransition>,
): BuilderDraft {
  return {
    ...draft,
    transitions: draft.transitions.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  };
}

export function removeTransition(draft: BuilderDraft, index: number): BuilderDraft {
  return { ...draft, transitions: draft.transitions.filter((_, i) => i !== index) };
}

/** Serialize the visual draft to the exact spec the host mutation consumes. */
export function toSpec(draft: BuilderDraft, name: string): DraftWorkflowSpec {
  return { name, states: draft.states, transitions: draft.transitions };
}

/** Canvas extents needed to fit every node (plus padding). */
export function canvasExtents(draft: BuilderDraft): { width: number; height: number } {
  const positions = Object.values(draft.positions);
  const maxX = Math.max(0, ...positions.map((p) => p.x));
  const maxY = Math.max(0, ...positions.map((p) => p.y));
  return { width: maxX + NODE_W + PAD * 2, height: maxY + NODE_H + PAD * 2 + 40 };
}
