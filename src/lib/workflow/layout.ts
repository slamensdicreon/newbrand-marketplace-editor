import type { WorkflowGraph } from './types';

/**
 * Deterministic layered layout for a workflow definition graph.
 *
 * States are assigned to columns by breadth-first distance from the initial
 * state (unreachable states go in a trailing column), and stacked by row
 * within each column. The canvas component turns these grid coordinates
 * into pixels; keeping this pure makes it unit-testable.
 */

export interface LaidOutNode {
  stateId: string;
  /** Column index (0 = initial state). */
  col: number;
  /** Row index within the column. */
  row: number;
}

export interface WorkflowLayout {
  nodes: LaidOutNode[];
  /** Number of columns. */
  cols: number;
  /** Height (in rows) of the tallest column. */
  rows: number;
}

export function layoutWorkflow(graph: WorkflowGraph): WorkflowLayout {
  const stateIds = graph.states.map((s) => s.stateId);
  const idSet = new Set(stateIds);
  const adjacency = new Map<string, string[]>();
  for (const t of graph.transitions) {
    if (!t.toStateId || !idSet.has(t.fromStateId) || !idSet.has(t.toStateId)) continue;
    const next = adjacency.get(t.fromStateId) ?? [];
    next.push(t.toStateId);
    adjacency.set(t.fromStateId, next);
  }

  const colOf = new Map<string, number>();
  const start = graph.states.find((s) => s.initial)?.stateId ?? stateIds[0];
  if (start) {
    colOf.set(start, 0);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const depth = colOf.get(current)!;
      for (const next of adjacency.get(current) ?? []) {
        if (!colOf.has(next)) {
          colOf.set(next, depth + 1);
          queue.push(next);
        }
      }
    }
  }
  // Unreachable states (no path from the initial state) go one column after
  // the deepest reachable one so they stay visible.
  const maxReached = Math.max(0, ...colOf.values());
  for (const id of stateIds) {
    if (!colOf.has(id)) colOf.set(id, maxReached + 1);
  }

  const rowsPerCol = new Map<number, number>();
  const nodes: LaidOutNode[] = graph.states.map((s) => {
    const col = colOf.get(s.stateId)!;
    const row = rowsPerCol.get(col) ?? 0;
    rowsPerCol.set(col, row + 1);
    return { stateId: s.stateId, col, row };
  });

  return {
    nodes,
    cols: nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.col)) + 1,
    rows: nodes.length === 0 ? 0 : Math.max(...rowsPerCol.values()),
  };
}
