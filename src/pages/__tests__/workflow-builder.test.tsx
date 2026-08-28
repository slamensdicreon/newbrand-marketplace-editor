// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * Drag-and-drop workflow builder UI: canvas authoring, inspectors,
 * connection validation, state-deletion cleanup, and guarded submission.
 */

const provider = vi.hoisted(() => ({
  workflows: { data: [] as { workflowId: string; displayName: string; states: unknown[] }[], isLoading: false },
  mutate: vi.fn(),
  isPending: false,
}));
vi.mock('@/lib/marketplace/provider', () => ({
  useWorkflows: () => provider.workflows,
  useCreateWorkflow: () => ({ mutate: provider.mutate, isPending: provider.isPending }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import WorkflowBuilder from '@/pages/workflow-builder';

function renderBuilder() {
  return render(<WorkflowBuilder />);
}

function nodeKeys(): string[] {
  return Array.from(document.querySelectorAll('[data-state-key]')).map(
    (el) => el.getAttribute('data-state-key')!,
  );
}

function addNamedState(name: string, options?: { initial?: boolean; final?: boolean }): string {
  fireEvent.click(screen.getByTestId('button-add-state'));
  const key = nodeKeys().at(-1)!;
  fireEvent.change(screen.getByTestId('input-inspector-state-name'), { target: { value: name } });
  if (options?.initial) fireEvent.click(screen.getByTestId('radio-inspector-initial'));
  if (options?.final) fireEvent.click(screen.getByTestId('checkbox-inspector-final'));
  return key;
}

function connectThroughInspector(fromKey: string, toKey: string, name: string): void {
  fireEvent.click(screen.getByTestId(`list-state-${fromKey}`));
  fireEvent.change(screen.getByTestId('select-inspector-connect'), { target: { value: toKey } });
  fireEvent.change(screen.getByTestId('input-inspector-transition-name'), { target: { value: name } });
}

beforeEach(() => {
  provider.workflows = { data: [], isLoading: false };
  provider.mutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => cleanup());

describe('WorkflowBuilder (visual)', () => {
  it('opens on a blank canvas with guidance hidden in clickable tool tips', () => {
    renderBuilder();
    expect(screen.getByTestId('builder-canvas')).toBeTruthy();
    expect(nodeKeys()).toHaveLength(0);
    expect(screen.getByText(/No states yet/i)).toBeTruthy();
    const tips = screen.getByTestId('builder-tips') as HTMLDetailsElement;
    expect(tips.open).toBe(false);
    fireEvent.click(within(tips).getByText('Tool tips'));
    expect(tips.open).toBe(true);
  });

  it('adds a state, selects it, renames it, and toggles flags from the inspector', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('button-add-state'));
    const keys = nodeKeys();
    expect(keys).toHaveLength(1);
    const newKey = keys[0]!;

    // New state is auto-selected: rename it.
    const nameInput = screen.getByTestId('input-inspector-state-name') as HTMLInputElement;
    expect(nameInput.value).toBe('');
    fireEvent.change(nameInput, { target: { value: 'Legal Review' } });
    expect(screen.getByTestId(`builder-node-${newKey}`).textContent).toContain('Legal Review');

    // Mark it initial: exactly one initial state remains.
    fireEvent.click(screen.getByTestId('radio-inspector-initial'));
    const initialBadges = Array.from(document.querySelectorAll('[data-testid^="builder-node-"]')).filter(
      (n) => n.textContent?.includes('initial'),
    );
    expect(initialBadges).toHaveLength(1);
    expect(initialBadges[0]!.textContent).toContain('Legal Review');
  });

  it('drags a node to a new position via pointer events', () => {
    renderBuilder();
    addNamedState('Draft');
    // Clear the selection so the drag assertion can distinguish a click.
    fireEvent.pointerDown(screen.getByTestId('builder-canvas'), { button: 0 });
    const key = nodeKeys()[0]!;
    const node = screen.getByTestId(`builder-node-${key}`);
    const before = (node.parentElement as HTMLElement).style.left;
    fireEvent.pointerDown(node, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 150 });
    fireEvent.pointerUp(window, { clientX: 210, clientY: 150 });
    const after = (screen.getByTestId(`builder-node-${key}`).parentElement as HTMLElement).style.left;
    expect(after).not.toBe(before);
    // A drag is not a click: nothing got selected.
    expect(screen.queryByTestId('input-inspector-state-name')).toBeNull();
  });

  it('creates a transition by dragging from a connection handle onto another node', () => {
    renderBuilder();
    const a = addNamedState('Draft', { initial: true });
    const b = addNamedState('Approved', { final: true });
    fireEvent.pointerDown(screen.getByTestId(`connect-handle-${a}`), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    // Hover the drop target, then release.
    fireEvent.pointerEnter(document.querySelector(`[data-state-key="${b}"]`)!);
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });

    // New edge exists and its inspector is open for naming.
    expect(screen.getByTestId('edge-label-0')).toBeTruthy();
    const input = screen.getByTestId('input-inspector-transition-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Submit' } });
    expect(screen.getByTestId('edge-label-0').textContent).toBe('Submit');
  });

  it('rejects duplicate connections with feedback and no new edge', () => {
    renderBuilder();
    const a = addNamedState('Draft', { initial: true });
    const b = addNamedState('Approved', { final: true });
    connectThroughInspector(a, b, 'Submit');
    fireEvent.pointerDown(screen.getByTestId(`connect-handle-${a}`), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerEnter(document.querySelector(`[data-state-key="${b}"]`)!);
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already connected/));
    expect(screen.queryByTestId('edge-label-1')).toBeNull();
  });

  it('keyboard users can connect states through the inspector select', () => {
    renderBuilder();
    const a = addNamedState('Draft', { initial: true });
    const b = addNamedState('Approved', { final: true });
    connectThroughInspector(a, b, 'Submit');
    expect(screen.getByTestId('edge-label-0')).toBeTruthy();
  });

  it('deleting a state removes its connected transitions', () => {
    renderBuilder();
    const first = addNamedState('Draft', { initial: true });
    const middle = addNamedState('Review');
    const last = addNamedState('Approved', { final: true });
    connectThroughInspector(first, middle, 'Submit');
    connectThroughInspector(middle, last, 'Approve');
    fireEvent.click(screen.getByTestId(`list-state-${middle}`));
    fireEvent.click(screen.getByTestId('button-inspector-remove-state'));
    expect(nodeKeys()).toHaveLength(2);
    expect(screen.queryByTestId('edge-label-0')).toBeNull();
    expect(within(screen.getByTestId('list-transitions')).queryAllByRole('button')).toHaveLength(0);
  });

  it('selecting an edge opens its inspector; removing it deletes the edge', () => {
    renderBuilder();
    const first = addNamedState('Draft', { initial: true });
    const last = addNamedState('Approved', { final: true });
    connectThroughInspector(first, last, 'Submit');
    expect((screen.getByTestId('input-inspector-transition-name') as HTMLInputElement).value).toBe(
      'Submit',
    );
    fireEvent.click(screen.getByTestId('button-inspector-remove-transition'));
    expect(screen.queryByTestId('edge-label-0')).toBeNull();
  });

  it('blocks submission while invalid and surfaces validation problems', () => {
    renderBuilder();
    // Unnamed new state makes the draft invalid.
    fireEvent.click(screen.getByTestId('button-add-state'));
    fireEvent.change(screen.getByTestId('input-workflow-name'), { target: { value: 'My Flow' } });
    expect(screen.getByTestId('alert-builder-problems').textContent).toMatch(/state needs a name/i);
    const submitBtn = screen.getByTestId('button-create-workflow') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    fireEvent.click(submitBtn);
    expect(provider.mutate).not.toHaveBeenCalled();
  });

  it('blocks duplicate workflow names', () => {
    provider.workflows = {
      data: [{ workflowId: 'wf1', displayName: 'My Flow', states: [] }],
      isLoading: false,
    };
    renderBuilder();
    fireEvent.change(screen.getByTestId('input-workflow-name'), { target: { value: 'my flow' } });
    expect(screen.getByTestId('text-duplicate-name')).toBeTruthy();
    expect((screen.getByTestId('button-create-workflow') as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits the serialized draft through the real create mutation when valid', () => {
    renderBuilder();
    const first = addNamedState('Draft', { initial: true });
    const last = addNamedState('Approved', { final: true });
    connectThroughInspector(first, last, 'Submit');
    fireEvent.change(screen.getByTestId('input-workflow-name'), { target: { value: 'My Flow' } });
    const submitBtn = screen.getByTestId('button-create-workflow') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    fireEvent.click(submitBtn);
    expect(provider.mutate).toHaveBeenCalledTimes(1);
    const [spec] = provider.mutate.mock.calls[0]!;
    expect(spec.name).toBe('My Flow');
    expect(spec.states).toHaveLength(2);
    expect(spec.transitions).toHaveLength(1);
    expect('positions' in spec).toBe(false);
  });
});
