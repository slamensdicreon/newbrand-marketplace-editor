// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkInboxEntry } from '@/lib/inbox';

const mocks = vi.hoisted(() => ({
  data: { entries: [] as WorkInboxEntry[], remainders: [] },
  host: {
    getQueue: vi.fn(),
    getStateCommands: vi.fn(),
    executeCommand: vi.fn(),
  },
}));

vi.mock('@/lib/inbox', async (original) => {
  const actual = await original<typeof import('@/lib/inbox')>();
  return {
    ...actual,
    useWorkInbox: () => ({
      data: mocks.data,
      isLoading: false,
      isError: false,
    }),
  };
});

vi.mock('@/lib/marketplace/provider', () => ({
  useHost: () => mocks.host,
}));

import Inbox from '@/pages/inbox';

const command = { commandId: 'approve', displayName: 'Approve', suppressComments: false };

function makeEntry(
  id: string,
  options: {
    workflow?: string;
    state?: string;
    urgency?: WorkInboxEntry['urgency'];
    commands?: WorkInboxEntry['commands'];
    language?: string;
  } = {},
): WorkInboxEntry {
  const workflowId = options.workflow ?? 'wf-one';
  const stateId = options.state ?? 'review';
  const item = {
    itemId: id,
    name: `Item ${id}`,
    path: `/content/${id}`,
    language: options.language ?? 'en',
    version: 1,
    updatedAt:
      options.urgency === 'fresh'
        ? new Date().toISOString()
        : new Date(Date.now() - (options.urgency === 'aging' ? 3 : 9) * 86_400_000).toISOString(),
    updatedBy: 'sitecore\\editor',
  };
  const workflow = {
    workflowId,
    displayName: workflowId === 'wf-one' ? 'Editorial Workflow' : 'Landing Page Workflow',
    states: [
      { stateId, displayName: stateId === 'review' ? 'Review' : 'Legal', initial: false, final: false },
      { stateId: 'done', displayName: 'Done', initial: false, final: true },
    ],
  };
  return {
    key: `${workflowId}::${stateId}::${id}::${item.language}::1`,
    workflow,
    state: workflow.states[0]!,
    item,
    commands: options.commands ?? [command],
    urgency: options.urgency ?? 'stale',
    reason: `${options.urgency === 'fresh' ? 'Fresh' : options.urgency === 'aging' ? 'Aging' : 'Stale'} — 9d in Review`,
  };
}

function renderInbox() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Inbox />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.host.getQueue.mockReset();
  mocks.host.getStateCommands.mockReset();
  mocks.host.executeCommand.mockReset();
  mocks.host.getStateCommands.mockResolvedValue([command]);
  mocks.data = {
    entries: [
      makeEntry('stale-one'),
      makeEntry('aging-two', { workflow: 'wf-two', state: 'legal', urgency: 'aging', language: 'da' }),
      makeEntry('fresh-three', { urgency: 'fresh' }),
    ],
    remainders: [],
  };
  mocks.host.getQueue.mockImplementation(async (_workflowId: string, _stateId: string) => ({
    items: mocks.data.entries.map((entry) => entry.item),
    hasNextPage: false,
    endCursor: null,
  }));
  mocks.host.executeCommand.mockResolvedValue({
    completed: true,
    successful: true,
    error: null,
    message: null,
    nextStateId: 'done',
  });
});

afterEach(cleanup);

describe('Work inbox', () => {
  it('shows cross-workflow work in urgency order and filters it', () => {
    renderInbox();
    const rows = screen.getAllByTestId(/^row-inbox-/);
    expect(rows[0]!.textContent).toContain('stale-one');
    expect(screen.getByText('Editorial Workflow')).toBeTruthy();
    expect(screen.getByText('Landing Page Workflow')).toBeTruthy();

    fireEvent.change(screen.getByTestId('select-workflow-filter'), { target: { value: 'wf-two' } });
    expect(screen.getByText('Item aging-two')).toBeTruthy();
    expect(screen.queryByText('Item stale-one')).toBeNull();
    fireEvent.change(screen.getByTestId('select-urgency-filter'), { target: { value: 'stale' } });
    expect(screen.getByTestId('text-empty-inbox')).toBeTruthy();
  });

  it('enforces command compatibility and the 25-item ceiling', () => {
    mocks.data.entries = Array.from({ length: 26 }, (_, index) => makeEntry(`batch-${index}`));
    mocks.data.entries.push(
      makeEntry('incompatible', {
        commands: [{ commandId: 'publish', displayName: 'Publish', suppressComments: false }],
      }),
    );
    renderInbox();
    fireEvent.click(screen.getByTestId('checkbox-inbox-batch-0'));
    expect((screen.getByTestId('checkbox-inbox-incompatible') as HTMLInputElement).disabled).toBe(true);
    for (let index = 1; index < 25; index += 1) {
      fireEvent.click(screen.getByTestId(`checkbox-inbox-batch-${index}`));
    }
    expect(screen.getByText('25 selected')).toBeTruthy();
    expect((screen.getByTestId('checkbox-inbox-batch-25') as HTMLInputElement).disabled).toBe(true);
  });

  it('lists every item in confirmation and continues after failures and stale skips', async () => {
    renderInbox();
    for (const id of ['stale-one', 'aging-two', 'fresh-three']) {
      fireEvent.click(screen.getByTestId(`checkbox-inbox-${id}`));
    }
    fireEvent.click(screen.getByTestId('button-bulk-approve'));
    const confirmation = screen.getByTestId('list-bulk-confirm');
    expect(within(confirmation).getByText('Item stale-one')).toBeTruthy();
    expect(within(confirmation).getByText('Item aging-two')).toBeTruthy();
    expect(within(confirmation).getByText('Item fresh-three')).toBeTruthy();

    mocks.host.getQueue.mockImplementation(async (_workflowId: string, stateId: string) => ({
      items: mocks.data.entries
        .filter((entry) => entry.state.stateId === stateId && entry.item.itemId !== 'fresh-three')
        .map((entry) => entry.item),
      hasNextPage: false,
      endCursor: null,
    }));
    mocks.host.executeCommand
      .mockResolvedValueOnce({
        completed: false,
        successful: false,
        error: 'Denied by Sitecore',
        message: null,
        nextStateId: null,
      })
      .mockResolvedValueOnce({
        completed: true,
        successful: true,
        error: null,
        message: null,
        nextStateId: 'done',
      });
    fireEvent.click(screen.getByTestId('button-confirm-bulk'));

    await waitFor(() => expect(screen.getByText(/1 succeeded, 1 failed, 1 skipped/)).toBeTruthy());
    expect(screen.getByTestId('result-failed-stale-one').textContent).toContain('Denied by Sitecore');
    expect(screen.getByTestId('result-success-aging-two')).toBeTruthy();
    expect(screen.getByTestId('result-stale-fresh-three')).toBeTruthy();
    expect(mocks.host.executeCommand).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('workflow-ops:action-log')).toContain('aging-two');
  });

  it('re-resolves each item with its own fresh read immediately before its write', async () => {
    renderInbox();
    for (const id of ['stale-one', 'aging-two', 'fresh-three']) {
      fireEvent.click(screen.getByTestId(`checkbox-inbox-${id}`));
    }
    fireEvent.click(screen.getByTestId('button-bulk-approve'));

    // Simulate a mid-run change: fresh-three leaves its state AFTER the run
    // begins (i.e. after earlier items' writes), so only a per-item fresh
    // read placed immediately before its own write can catch it.
    let queueReads = 0;
    mocks.host.getQueue.mockImplementation(async (_workflowId: string, stateId: string) => {
      queueReads += 1;
      const dropFreshThree = queueReads >= 3;
      return {
        items: mocks.data.entries
          .filter(
            (entry) =>
              entry.state.stateId === stateId &&
              (!dropFreshThree || entry.item.itemId !== 'fresh-three'),
          )
          .map((entry) => entry.item),
        hasNextPage: false,
        endCursor: null,
      };
    });
    mocks.host.executeCommand.mockResolvedValue({
      completed: true,
      successful: true,
      error: null,
      message: null,
      nextStateId: 'done',
    });
    fireEvent.click(screen.getByTestId('button-confirm-bulk'));

    await waitFor(() => expect(screen.getByText(/2 succeeded, 0 failed, 1 skipped/)).toBeTruthy());
    // One fresh read per selected item, each immediately before that item's write.
    expect(mocks.host.getQueue).toHaveBeenCalledTimes(3);
    expect(mocks.host.executeCommand).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('result-stale-fresh-three')).toBeTruthy();
  });

  it('still executes an item that was pushed past the first fresh page', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('checkbox-inbox-stale-one'));
    fireEvent.click(screen.getByTestId('button-bulk-approve'));

    // Fresh read: page one is full of concurrently added items; the selected
    // item now lives on page two. Only paginated re-resolution finds it.
    mocks.host.getQueue.mockImplementation(async (_wf: string, _st: string, after?: string | null) => {
      if (!after) {
        return {
          items: Array.from({ length: 25 }, (_, i) => ({
            itemId: `new-${i}`,
            name: `New ${i}`,
            path: `/content/new-${i}`,
            language: 'en',
            version: 1,
            updatedAt: new Date().toISOString(),
            updatedBy: 'sitecore\\other',
          })),
          hasNextPage: true,
          endCursor: 'page-2',
        };
      }
      return {
        items: mocks.data.entries.map((entry) => entry.item),
        hasNextPage: false,
        endCursor: null,
      };
    });
    fireEvent.click(screen.getByTestId('button-confirm-bulk'));

    await waitFor(() => expect(screen.getByText(/1 succeeded, 0 failed, 0 skipped/)).toBeTruthy());
    expect(mocks.host.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('skips with a precise outcome when the command becomes unavailable mid-run', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('checkbox-inbox-stale-one'));
    fireEvent.click(screen.getByTestId('checkbox-inbox-fresh-three'));
    fireEvent.click(screen.getByTestId('button-bulk-approve'));

    // Approve is revoked after the first item's write.
    mocks.host.getStateCommands
      .mockResolvedValueOnce([command])
      .mockResolvedValueOnce([]);
    fireEvent.click(screen.getByTestId('button-confirm-bulk'));

    await waitFor(() => expect(screen.getByText(/1 succeeded, 1 failed, 0 skipped/)).toBeTruthy());
    expect(mocks.host.executeCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('result-failed-fresh-three').textContent).toContain(
      'no longer available',
    );
  });
});