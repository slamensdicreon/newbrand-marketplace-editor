import { describe, expect, it } from 'vitest';
import {
  compareInboxEntries,
  inboxItemKey,
  intersectCommands,
  resolveQueueMembership,
  prioritizationReason,
  type WorkInboxEntry,
} from '@/lib/inbox';
import type { QueueItem, WorkflowCommandInfo } from '@/lib/workflow/types';

const workflow = { workflowId: 'wf', displayName: 'Workflow', states: [] };
const state = { stateId: 'state', displayName: 'Review', initial: false, final: false };

function entry(
  id: string,
  updatedAt: string | null,
  urgency: WorkInboxEntry['urgency'],
  commands: WorkflowCommandInfo[] = [],
): WorkInboxEntry {
  const item: QueueItem = {
    itemId: id,
    name: id,
    path: `/${id}`,
    language: 'en',
    version: 1,
    updatedAt,
    updatedBy: null,
  };
  return {
    key: inboxItemKey(item, workflow.workflowId, state.stateId),
    workflow,
    state,
    item,
    commands,
    urgency,
    reason: '',
  };
}

describe('work inbox helpers', () => {
  it('sorts urgency first and oldest first within a bucket', () => {
    const values = [
      entry('fresh', '2025-01-01T00:00:00Z', 'fresh'),
      entry('new-stale', '2025-02-01T00:00:00Z', 'stale'),
      entry('old-stale', '2025-01-01T00:00:00Z', 'stale'),
      entry('unknown', null, 'unknown'),
      entry('aging', '2025-01-01T00:00:00Z', 'aging'),
    ].sort(compareInboxEntries);
    expect(values.map((value) => value.item.itemId)).toEqual([
      'old-stale',
      'new-stale',
      'aging',
      'fresh',
      'unknown',
    ]);
  });

  it('intersects commands by command id while preserving first-entry metadata', () => {
    const approve = { commandId: 'approve', displayName: 'Approve', suppressComments: false };
    const reject = { commandId: 'reject', displayName: 'Reject', suppressComments: false };
    expect(
      intersectCommands([
        entry('a', null, 'unknown', [approve, reject]),
        entry('b', null, 'unknown', [{ ...approve, displayName: 'Other label' }]),
      ]),
    ).toEqual([approve]);
    expect(intersectCommands([entry('a', null, 'unknown', [approve]), entry('b', null, 'unknown', [reject])])).toEqual([]);
  });

  it('resolves queue membership across pages and reports authoritative absence', async () => {
    const pages = new Map([
      [
        'first',
        { items: [{ itemId: 'other', language: 'en', version: 1 }], hasNextPage: true, endCursor: 'c1' },
      ],
      [
        'c1',
        { items: [{ itemId: 'target', language: 'en', version: 1 }], hasNextPage: false, endCursor: null },
      ],
    ]);
    const host = {
      getQueue: async (_wf: string, _st: string, after?: string | null) =>
        pages.get(after ?? 'first')! as never,
    };
    const key = inboxItemKey({ itemId: 'target', language: 'en', version: 1 });
    await expect(resolveQueueMembership(host, 'wf', 'st', key)).resolves.toBe('present');
    await expect(
      resolveQueueMembership(host, 'wf', 'st', inboxItemKey({ itemId: 'missing', language: 'en', version: 1 })),
    ).resolves.toBe('absent');
    const endless = {
      getQueue: async () =>
        ({ items: [], hasNextPage: true, endCursor: 'next' }) as never,
    };
    await expect(resolveQueueMembership(endless, 'wf', 'st', key, 3)).resolves.toBe('unresolved');
  });

  it('creates human-readable reasons without inventing an age', () => {
    expect(prioritizationReason('stale', '2025-01-01T00:00:00Z', 'Review')).toMatch(
      /^Stale — \d+d in Review$/,
    );
    expect(prioritizationReason('unknown', null, 'Review')).toBe('Age unknown — in Review');
  });
});