import { describe, expect, it } from 'vitest';
import { layoutWorkflow } from '@/lib/workflow/layout';
import type { WorkflowGraph } from '@/lib/workflow/types';

function graph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    workflowId: 'wf',
    states: [
      { stateId: 'a', displayName: 'Draft', initial: true, final: false },
      { stateId: 'b', displayName: 'Review', initial: false, final: false },
      { stateId: 'c', displayName: 'Done', initial: false, final: true },
    ],
    transitions: [
      { commandId: 't1', displayName: 'Submit', fromStateId: 'a', toStateId: 'b' },
      { commandId: 't2', displayName: 'Approve', fromStateId: 'b', toStateId: 'c' },
      { commandId: 't3', displayName: 'Reject', fromStateId: 'b', toStateId: 'a' },
    ],
    ...overrides,
  };
}

describe('layoutWorkflow', () => {
  it('lays a linear flow out left to right from the initial state', () => {
    const layout = layoutWorkflow(graph());
    const cols = Object.fromEntries(layout.nodes.map((n) => [n.stateId, n.col]));
    expect(cols).toEqual({ a: 0, b: 1, c: 2 });
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(1);
  });

  it('stacks branch targets in the same column', () => {
    const layout = layoutWorkflow(
      graph({
        states: [
          { stateId: 'a', displayName: 'Draft', initial: true, final: false },
          { stateId: 'b', displayName: 'Approved', initial: false, final: true },
          { stateId: 'c', displayName: 'Rejected', initial: false, final: true },
        ],
        transitions: [
          { commandId: 't1', displayName: 'Approve', fromStateId: 'a', toStateId: 'b' },
          { commandId: 't2', displayName: 'Reject', fromStateId: 'a', toStateId: 'c' },
        ],
      }),
    );
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.stateId, n]));
    expect(byId['b']!.col).toBe(1);
    expect(byId['c']!.col).toBe(1);
    expect(byId['b']!.row).not.toBe(byId['c']!.row);
    expect(layout.rows).toBe(2);
  });

  it('places unreachable states in a trailing column', () => {
    const layout = layoutWorkflow(
      graph({
        transitions: [
          { commandId: 't1', displayName: 'Submit', fromStateId: 'a', toStateId: 'b' },
        ],
      }),
    );
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.stateId, n.col]));
    expect(byId['c']).toBe(2); // one past the deepest reachable column
  });

  it('ignores transitions without a target and handles empty graphs', () => {
    const layout = layoutWorkflow(
      graph({
        transitions: [
          { commandId: 't1', displayName: 'Noop', fromStateId: 'a', toStateId: null },
        ],
      }),
    );
    expect(layout.nodes).toHaveLength(3);
    expect(layoutWorkflow(graph({ states: [], transitions: [] })).nodes).toHaveLength(0);
  });
});
