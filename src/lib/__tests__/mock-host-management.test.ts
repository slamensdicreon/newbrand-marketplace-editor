import { describe, expect, it } from 'vitest';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';

function host() {
  return new MockMarketplaceHost({ latencyMs: 0 });
}

describe('MockMarketplaceHost definition management', () => {
  it('returns the demo workflow graph with transition edges', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const graph = await h.getWorkflowGraph(wf!.workflowId);
    expect(graph.states.length).toBe(wf!.states.length);
    expect(graph.transitions.length).toBeGreaterThan(0);
    // Every edge references known states.
    const ids = new Set(graph.states.map((s) => s.stateId));
    for (const t of graph.transitions) {
      expect(ids.has(t.fromStateId)).toBe(true);
      expect(t.toStateId === null || ids.has(t.toStateId)).toBe(true);
    }
  });

  it('adds a state and reflects it in the graph and counts', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const { stateId } = await h.addState(wf!.workflowId, 'Legal Review', false);
    const graph = await h.getWorkflowGraph(wf!.workflowId);
    expect(graph.states.some((s) => s.stateId === stateId && s.displayName === 'Legal Review')).toBe(true);
    const counts = await h.getStateCounts(wf!.workflowId, [stateId]);
    expect(counts[stateId]).toBe(0);
  });

  it('adds a transition usable by items already in the source state', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const draft = wf!.states.find((s) => s.initial)!;
    const final = wf!.states.find((s) => s.final)!;
    const { commandId } = await h.addTransition(draft.stateId, 'Fast-track', final.stateId);

    const graph = await h.getWorkflowGraph(wf!.workflowId);
    expect(graph.transitions.some((t) => t.commandId === commandId)).toBe(true);

    const commands = await h.getStateCommands(wf!.workflowId, draft.stateId);
    expect(commands.some((c) => c.commandId === commandId)).toBe(true);

    const queue = await h.getQueue(wf!.workflowId, draft.stateId);
    const item = queue.items[0]!;
    const result = await h.executeCommand({
      itemId: item.itemId,
      version: item.version,
      language: item.language,
      commandId,
    });
    expect(result.successful).toBe(true);
    const finalQueue = await h.getQueue(wf!.workflowId, final.stateId);
    expect(finalQueue.items.some((i) => i.itemId === item.itemId)).toBe(true);
  });

  it('deletes a transition, removing it from commands and edges', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const graph = await h.getWorkflowGraph(wf!.workflowId);
    const edge = graph.transitions[0]!;
    await h.deleteDefinitionItem(edge.commandId);

    const after = await h.getWorkflowGraph(wf!.workflowId);
    expect(after.transitions.some((t) => t.commandId === edge.commandId)).toBe(false);
    const commands = await h.getStateCommands(wf!.workflowId, edge.fromStateId);
    expect(commands.some((c) => c.commandId === edge.commandId)).toBe(false);
  });

  it('deletes a state and its outgoing transitions', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const { stateId } = await h.addState(wf!.workflowId, 'Temp', false);
    const final = wf!.states.find((s) => s.final)!;
    await h.addTransition(stateId, 'Out', final.stateId);

    await h.deleteDefinitionItem(stateId);
    const graph = await h.getWorkflowGraph(wf!.workflowId);
    expect(graph.states.some((s) => s.stateId === stateId)).toBe(false);
    expect(graph.transitions.some((t) => t.fromStateId === stateId)).toBe(false);
  });

  it('deletes a whole workflow', async () => {
    const h = host();
    const before = await h.listWorkflows();
    const [wf] = before;
    await h.deleteDefinitionItem(wf!.workflowId);
    const after = await h.listWorkflows();
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((w) => w.workflowId === wf!.workflowId)).toBe(false);
  });

  it('rejects deleting an unknown item', async () => {
    await expect(host().deleteDefinitionItem('{00000000-0000-0000-0000-000000000000}')).rejects.toThrow();
  });
});
