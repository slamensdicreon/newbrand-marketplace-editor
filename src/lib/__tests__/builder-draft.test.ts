import { describe, expect, it } from 'vitest';
import {
  addState,
  autoPositions,
  canvasExtents,
  connectStates,
  connectionProblem,
  defaultDraft,
  findFreePosition,
  moveState,
  removeState,
  removeTransition,
  toSpec,
  updateState,
  updateTransition,
} from '@/lib/workflow/builder-draft';
import { validateDraftWorkflow } from '@/lib/workflow/types';

function completeDraft() {
  let draft = defaultDraft();
  const first = addState(draft);
  draft = updateState(first.draft, first.key, { name: 'Draft', initial: true });
  const second = addState(draft);
  draft = updateState(second.draft, second.key, { name: 'Awaiting Approval' });
  const third = addState(draft);
  draft = updateState(third.draft, third.key, { name: 'Approved', final: true });
  draft = connectStates(draft, first.key, second.key, 'Submit').draft;
  draft = connectStates(draft, second.key, third.key, 'Approve').draft;
  draft = connectStates(draft, second.key, first.key, 'Reject').draft;
  return draft;
}

describe('builder draft model', () => {
  it('starts with a completely blank canvas', () => {
    const draft = defaultDraft();
    expect(draft).toEqual({ states: [], transitions: [], positions: {} });
  });

  it('addState places new nodes at a free position with a unique stable key', () => {
    let draft = defaultDraft();
    const first = addState(draft);
    draft = first.draft;
    const second = addState(draft);
    expect(first.key).not.toBe(second.key);
    const p1 = first.draft.positions[first.key]!;
    const p2 = second.draft.positions[second.key]!;
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(p1).not.toEqual(p2);
  });

  it('moveState updates position and clamps to the canvas origin', () => {
    const draft = completeDraft();
    const key = draft.states[0]!.key;
    const moved = moveState(draft, key, { x: -50, y: 120.6 });
    expect(moved.positions[key]).toEqual({ x: 0, y: 121 });
    // Unknown keys are ignored.
    expect(moveState(draft, 'nope', { x: 1, y: 1 })).toBe(draft);
  });

  it('updateState keeps exactly one initial state', () => {
    const draft = completeDraft();
    const second = draft.states[1]!.key;
    const updated = updateState(draft, second, { initial: true });
    expect(updated.states.filter((s) => s.initial).map((s) => s.key)).toEqual([second]);
  });

  it('removeState drops the node, its position, and all connected transitions', () => {
    const draft = completeDraft();
    const middle = draft.states[1]!.key; // Awaiting Approval: 3 touching transitions
    const removed = removeState(draft, middle);
    expect(removed.states).toHaveLength(2);
    expect(removed.positions[middle]).toBeUndefined();
    expect(removed.transitions).toHaveLength(0);
  });

  it('rejects self-loops and duplicate connections, allows valid ones', () => {
    const draft = completeDraft();
    const [a, b, c] = draft.states.map((s) => s.key);
    expect(connectionProblem(draft, a!, a!)).toMatch(/different state/);
    expect(connectionProblem(draft, a!, b!)).toMatch(/already connected/);
    // Reverse direction of an existing edge is allowed (a→b exists; c→a doesn't).
    expect(connectionProblem(draft, c!, b!)).toBeNull();

    const rejected = connectStates(draft, a!, b!);
    expect(rejected.problem).toBeTruthy();
    expect(rejected.draft).toBe(draft);
    expect(rejected.index).toBe(-1);

    const ok = connectStates(draft, c!, b!, 'Reopen');
    expect(ok.problem).toBeNull();
    expect(ok.index).toBe(3);
    expect(ok.draft.transitions[3]).toEqual({ name: 'Reopen', fromKey: c, toKey: b });
  });

  it('updateTransition and removeTransition target by index', () => {
    const draft = completeDraft();
    const renamed = updateTransition(draft, 0, { name: 'Send for review' });
    expect(renamed.transitions[0]!.name).toBe('Send for review');
    const removed = removeTransition(renamed, 0);
    expect(removed.transitions).toHaveLength(2);
    expect(removed.transitions[0]!.name).toBe('Approve');
  });

  it('serializes to the exact host spec and passes validation when complete', () => {
    const draft = completeDraft();
    const spec = toSpec(draft, 'Review Flow');
    expect(spec).toEqual({ name: 'Review Flow', states: draft.states, transitions: draft.transitions });
    expect(validateDraftWorkflow(spec)).toEqual([]);
    // Positions never leak into the payload.
    expect('positions' in spec).toBe(false);
  });

  it('an incomplete visual draft fails validation (no browser-only success)', () => {
    let draft = completeDraft();
    // Remove the initial state: validation must complain.
    draft = removeState(draft, draft.states[0]!.key);
    const problems = validateDraftWorkflow(toSpec(draft, 'Broken'));
    expect(problems.some((p) => /initial state/i.test(p))).toBe(true);
  });

  it('findFreePosition avoids existing nodes and extents cover all nodes', () => {
    const draft = completeDraft();
    const free = findFreePosition(draft);
    for (const p of Object.values(draft.positions)) {
      const clash = Math.abs(p.x - free.x) < 100 && Math.abs(p.y - free.y) < 50;
      expect(clash).toBe(false);
    }
    const { width, height } = canvasExtents(draft);
    for (const p of Object.values(draft.positions)) {
      expect(p.x).toBeLessThan(width);
      expect(p.y).toBeLessThan(height);
    }
  });

  it('autoPositions lays a linear flow left to right', () => {
    const draft = completeDraft();
    const pos = autoPositions(draft.states, draft.transitions);
    const [a, b, c] = draft.states.map((s) => pos[s.key]!);
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
  });
});
