import { describe, expect, it } from 'vitest';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';

function host() {
  return new MockMarketplaceHost({ latencyMs: 0 });
}

describe('MockMarketplaceHost workflows', () => {
  it('lists the demo workflow with one initial and one final state', async () => {
    const workflows = await host().listWorkflows();
    expect(workflows.length).toBeGreaterThan(0);
    const wf = workflows[0]!;
    expect(wf.states.filter((s) => s.initial)).toHaveLength(1);
    expect(wf.states.some((s) => s.final)).toBe(true);
  });

  it('counts match queue contents', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const counts = await h.getStateCounts(
      wf!.workflowId,
      wf!.states.map((s) => s.stateId),
    );
    for (const state of wf!.states) {
      const queue = await h.getQueue(wf!.workflowId, state.stateId);
      expect(counts[state.stateId]).toBe(queue.items.length);
    }
  });

  it('executes a command, moving the item and recording history', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const draft = wf!.states.find((s) => s.initial)!;
    const queue = await h.getQueue(wf!.workflowId, draft.stateId);
    const item = queue.items[0]!;
    const commands = await h.getStateCommands(wf!.workflowId, draft.stateId);
    expect(commands.length).toBeGreaterThan(0);

    const result = await h.executeCommand({
      itemId: item.itemId,
      language: item.language,
      version: item.version,
      commandId: commands[0]!.commandId,
      comments: 'Looks good',
    });
    expect(result.successful).toBe(true);
    expect(result.nextStateId).toBeTruthy();

    const after = await h.getQueue(wf!.workflowId, draft.stateId);
    expect(after.items.some((i) => i.itemId === item.itemId)).toBe(false);
    const target = await h.getQueue(wf!.workflowId, result.nextStateId!);
    expect(target.items.some((i) => i.itemId === item.itemId)).toBe(true);

    const history = await h.getItemHistory(wf!.workflowId, item.itemId, item.language);
    expect(history.at(-1)?.comments).toContain('Looks good');
  });

  it('fails cleanly for a command not valid from the current state', async () => {
    const h = host();
    const [wf] = await h.listWorkflows();
    const draft = wf!.states.find((s) => s.initial)!;
    const queue = await h.getQueue(wf!.workflowId, draft.stateId);
    const result = await h.executeCommand({
      itemId: queue.items[0]!.itemId,
      language: 'en',
      version: 1,
      commandId: '{00000000-0000-0000-0000-000000000000}',
    });
    expect(result.successful).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('creates a valid draft workflow and rejects an invalid one', async () => {
    const h = host();
    const created = await h.createDraftWorkflow({
      name: 'Test Flow',
      states: [
        { key: 'a', name: 'Draft', initial: true, final: false },
        { key: 'b', name: 'Done', initial: false, final: true },
      ],
      transitions: [{ name: 'Finish', fromKey: 'a', toKey: 'b' }],
    });
    expect(created.workflowId).toBeTruthy();
    const workflows = await h.listWorkflows();
    expect(workflows.some((w) => w.displayName === 'Test Flow')).toBe(true);

    await expect(
      h.createDraftWorkflow({
        name: 'Broken',
        states: [{ key: 'a', name: 'Only', initial: true, final: false }],
        transitions: [],
      }),
    ).rejects.toThrow();
  });
});
