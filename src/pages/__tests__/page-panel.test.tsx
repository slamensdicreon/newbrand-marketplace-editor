// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ItemWorkflowStatus, PageContextInfo } from '@/lib/marketplace/host';

const command = { commandId: 'cmd-approve', displayName: 'Approve', suppressComments: false };

const mocks = vi.hoisted(() => ({
  activeHostKey: 'test:1',
  pageListeners: [] as Array<(page: unknown) => void>,
  updateListeners: [] as Array<() => void>,
  host: {
    getItemWorkflowStatus: vi.fn(),
    getStateCommands: vi.fn(),
    executeCommand: vi.fn(),
    getItemHistory: vi.fn(),
    getWorkflowGraph: vi.fn(),
    subscribePageContext: vi.fn(),
    subscribeContentUpdates: vi.fn(),
    getBrandReviewSupport: vi.fn(),
    getItemReviewContent: vi.fn(),
    generateBrandReview: vi.fn(),
  },
}));

vi.mock('@/lib/marketplace/provider', async (original) => {
  const { useQuery, useQueryClient, useMutation } = await import('@tanstack/react-query');
  const actual = await original<typeof import('@/lib/marketplace/provider')>();
  const { useEffect, useState } = await import('react');
  const host = mocks.host as unknown as import('@/lib/marketplace/host').MarketplaceHost;
  return {
    ...actual,
    useHost: () => host,
    useHostKey: () => 'test:1',
    getActiveHostKey: () => mocks.activeHostKey,
    useMarketplace: () => ({ status: { state: 'live', host }, hostKey: 'test:1', retry: () => {} }),
    usePageContext: () => {
      const [state, setState] = useState<{ page: PageContextInfo | null; ready: boolean }>({
        page: null,
        ready: false,
      });
      useEffect(() => {
        const listener = (page: unknown) =>
          setState({ page: page as PageContextInfo | null, ready: true });
        mocks.pageListeners.push(listener);
        return () => {
          mocks.pageListeners = mocks.pageListeners.filter((l) => l !== listener);
        };
      }, []);
      return state;
    },
    usePageContentUpdates: (itemId: string | undefined) => {
      const queryClient = useQueryClient();
      useEffect(() => {
        if (!itemId) return;
        const listener = () => {
          void queryClient.invalidateQueries({ queryKey: ['item-workflow-status', itemId] });
        };
        mocks.updateListeners.push(listener);
        return () => {
          mocks.updateListeners = mocks.updateListeners.filter((l) => l !== listener);
        };
      }, [itemId, queryClient]);
    },
    useItemWorkflowStatus: (itemId: string | undefined, language: string | undefined) =>
      useQuery({
        queryKey: ['item-workflow-status', itemId, language, 'test:1'],
        queryFn: () => mocks.host.getItemWorkflowStatus(itemId!, language!),
        enabled: !!itemId && !!language,
      }),
    useStateCommands: (workflowId: string | undefined, stateId: string | undefined) =>
      useQuery({
        queryKey: ['workflow-commands', workflowId, stateId, 'test:1'],
        queryFn: () => mocks.host.getStateCommands(workflowId!, stateId!),
        enabled: !!workflowId && !!stateId,
      }),
    useItemHistory: (workflowId: string | undefined, itemId: string | undefined, language: string) =>
      useQuery({
        queryKey: ['workflow-history', workflowId, itemId, language, 'test:1'],
        queryFn: () => mocks.host.getItemHistory(workflowId!, itemId!, language),
        enabled: !!workflowId && !!itemId,
      }),
    useWorkflowGraph: (workflowId: string | undefined) =>
      useQuery({
        queryKey: ['workflow-graph', workflowId, 'test:1'],
        queryFn: () => mocks.host.getWorkflowGraph(workflowId!),
        enabled: !!workflowId,
      }),
    useBrandReviewSupport: () =>
      useQuery({
        queryKey: ['brand-review-support', 'test:1'],
        queryFn: () => mocks.host.getBrandReviewSupport(),
      }),
    useGenerateBrandReview: () =>
      useMutation({
        mutationFn: async (args: { itemId: string; language: string }) => {
          const support = await mocks.host.getBrandReviewSupport();
          if (!support.available || !support.brandKitId) {
            throw new Error(support.message ?? 'Brand Review is not available.');
          }
          const content = await mocks.host.getItemReviewContent(args.itemId, args.language);
          const sections = await mocks.host.generateBrandReview(support.brandKitId, content);
          return {
            generatedAt: new Date().toISOString(),
            fingerprint: 'fp-test',
            contentUpdatedAt: content.updatedAt,
            demo: false,
            truncated: content.truncated,
            sections,
          };
        },
      }),
  };
});

import PagePanel from '@/pages/page-panel';

function makePage(id: string, name: string): PageContextInfo {
  return { itemId: id, name, path: `/content/${name}`, language: 'en', version: 1, route: null };
}

function makeStatus(id: string, overrides: Partial<ItemWorkflowStatus> = {}): ItemWorkflowStatus {
  return {
    itemId: id,
    name: `Page ${id}`,
    path: `/content/page-${id}`,
    language: 'en',
    version: 1,
    updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    workflow: { workflowId: 'wf-1', displayName: 'Editorial Workflow' },
    state: { stateId: 'st-review', displayName: 'Review', final: false },
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PagePanel />
    </QueryClientProvider>,
  );
}

function emitPage(page: PageContextInfo | null) {
  act(() => {
    for (const listener of mocks.pageListeners) listener(page);
  });
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.activeHostKey = 'test:1';
  mocks.pageListeners = [];
  mocks.updateListeners = [];
  for (const fn of Object.values(mocks.host)) fn.mockReset();
  mocks.host.getItemWorkflowStatus.mockImplementation(async (itemId: string) =>
    makeStatus(itemId),
  );
  mocks.host.getStateCommands.mockResolvedValue([command]);
  mocks.host.getItemHistory.mockResolvedValue([
    {
      date: new Date().toISOString(),
      user: 'sitecore\\maria',
      oldState: 'Draft',
      newState: 'Review',
      comments: [],
    },
  ]);
  mocks.host.getWorkflowGraph.mockResolvedValue({
    workflowId: 'wf-1',
    states: [
      { stateId: 'st-review', displayName: 'Review', initial: false, final: false },
      { stateId: 'st-done', displayName: 'Done', initial: false, final: true },
    ],
    transitions: [
      {
        commandId: 'cmd-approve',
        displayName: 'Approve',
        fromStateId: 'st-review',
        toStateId: 'st-done',
      },
    ],
  });
  mocks.host.executeCommand.mockResolvedValue({
    completed: true,
    successful: true,
    error: null,
    message: null,
    nextStateId: 'st-done',
  });
  mocks.host.getBrandReviewSupport.mockResolvedValue({
    available: true,
    brandKitId: 'kit-1',
    message: null,
  });
  mocks.host.getItemReviewContent.mockImplementation(async (itemId: string) => ({
    itemId,
    language: 'en',
    version: 1,
    updatedAt: '2026-08-01T00:00:00Z',
    entries: [{ source: 'field', label: 'Title', text: 'Hello' }],
    truncated: false,
  }));
  mocks.host.generateBrandReview.mockResolvedValue([
    { sectionId: 'voice-and-tone', score: 4, reason: 'Good.', suggestion: 'Keep it.', fields: [] },
  ]);
});

afterEach(cleanup);

describe('Page builder workflow panel', () => {
  it('shows an empty prompt until a page context arrives, then that page workflow', async () => {
    renderPanel();
    emitPage(null);
    expect(screen.getByTestId('text-no-page')).toBeTruthy();

    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('text-workflow-name')).toBeTruthy());
    expect(screen.getByTestId('text-workflow-name').textContent).toBe('Editorial Workflow');
    expect(screen.getByTestId('badge-page-state').textContent).toContain('Review');
    await waitFor(() =>
      expect(screen.getByTestId('list-panel-history').textContent).toContain('Draft → Review'),
    );
    expect(mocks.host.getItemWorkflowStatus).toHaveBeenCalledWith('page-a', 'en');
  });

  it('refreshes on navigation without leaking the previous page', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByText('Page page-a')).toBeTruthy());

    mocks.host.getItemWorkflowStatus.mockImplementation(async (itemId: string) =>
      makeStatus(itemId, {
        workflow: { workflowId: 'wf-2', displayName: 'Landing Workflow' },
        state: { stateId: 'st-legal', displayName: 'Legal', final: false },
      }),
    );
    emitPage(makePage('page-b', 'Spring'));
    await waitFor(() => expect(screen.getByText('Page page-b')).toBeTruthy());
    expect(screen.queryByText('Page page-a')).toBeNull();
    expect(screen.getByTestId('text-workflow-name').textContent).toBe('Landing Workflow');
  });

  it('shows a clear message for pages outside any workflow', async () => {
    mocks.host.getItemWorkflowStatus.mockResolvedValue(
      makeStatus('page-a', { workflow: null, state: null }),
    );
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('text-no-workflow')).toBeTruthy());
    expect(screen.queryByTestId('button-panel-command-cmd-approve')).toBeNull();
  });

  it('requires explicit confirmation with an impact review, then executes and refreshes', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() =>
      expect(screen.getByTestId('button-panel-command-cmd-approve')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('button-panel-command-cmd-approve'));

    const dialog = await screen.findByTestId('dialog-panel-confirm');
    expect(dialog.textContent).toContain('/content/page-page-a');
    expect(dialog.textContent).toContain('From: Review');
    expect(dialog.textContent).toContain('To: Done');
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('input-panel-comments'), {
      target: { value: 'Looks good' },
    });
    fireEvent.click(screen.getByTestId('button-panel-confirm'));
    await waitFor(() => expect(mocks.host.executeCommand).toHaveBeenCalledTimes(1));
    expect(mocks.host.executeCommand).toHaveBeenCalledWith({
      itemId: 'page-a',
      language: 'en',
      version: 1,
      commandId: 'cmd-approve',
      comments: 'Looks good',
    });
    // Fresh status + fresh commands were read again immediately before the write.
    expect(mocks.host.getItemWorkflowStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sessionStorage.getItem('workflow-ops:action-log')).toContain('Approve');
  });

  it('aborts without writing when the page moved states since the panel loaded', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() =>
      expect(screen.getByTestId('button-panel-command-cmd-approve')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('button-panel-command-cmd-approve'));

    mocks.host.getItemWorkflowStatus.mockResolvedValue(
      makeStatus('page-a', { state: { stateId: 'st-done', displayName: 'Done', final: true } }),
    );
    fireEvent.click(screen.getByTestId('button-panel-confirm'));
    await waitFor(() =>
      expect(mocks.host.getItemWorkflowStatus.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
  });

  it('aborts without writing when the command was revoked in the meantime', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() =>
      expect(screen.getByTestId('button-panel-command-cmd-approve')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('button-panel-command-cmd-approve'));

    mocks.host.getStateCommands.mockResolvedValue([]);
    fireEvent.click(screen.getByTestId('button-panel-confirm'));
    await waitFor(() => expect(mocks.host.getStateCommands.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(mocks.host.executeCommand).not.toHaveBeenCalled());
  });

  it('aborts a confirmed command when the editor navigates away mid-guard', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() =>
      expect(screen.getByTestId('button-panel-command-cmd-approve')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('button-panel-command-cmd-approve'));
    await screen.findByTestId('dialog-panel-confirm');

    // The fresh-status guard hangs until we release it; meanwhile the
    // Page builder navigates to another page.
    let release!: (value: ItemWorkflowStatus) => void;
    mocks.host.getItemWorkflowStatus.mockImplementationOnce(
      () => new Promise<ItemWorkflowStatus>((resolve) => (release = resolve)),
    );
    fireEvent.click(screen.getByTestId('button-panel-confirm'));
    await waitFor(() => expect(release).toBeTruthy());
    emitPage(makePage('page-b', 'Spring'));
    release(makeStatus('page-a'));

    await waitFor(() => expect(screen.getByText('Page page-b')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
  });

  it('aborts a confirmed command when the host generation changes mid-guard', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() =>
      expect(screen.getByTestId('button-panel-command-cmd-approve')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('button-panel-command-cmd-approve'));
    await screen.findByTestId('dialog-panel-confirm');

    let release!: (value: ItemWorkflowStatus) => void;
    mocks.host.getItemWorkflowStatus.mockImplementationOnce(
      () => new Promise<ItemWorkflowStatus>((resolve) => (release = resolve)),
    );
    fireEvent.click(screen.getByTestId('button-panel-confirm'));
    await waitFor(() => expect(release).toBeTruthy());
    mocks.activeHostKey = 'live:2'; // demo→live handoff while the guard is in flight
    release(makeStatus('page-a'));

    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
  });

  it('offers the advisory AI quality check for the current page without touching commands', async () => {
    // Pin the page's __Updated to the timestamp captured at review time.
    mocks.host.getItemWorkflowStatus.mockImplementation(async (itemId: string) =>
      makeStatus(itemId, { updatedAt: '2026-08-01T00:00:00Z' }),
    );
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('panel-brand-review-page-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('button-run-brand-review-page-a'));
    await waitFor(() => expect(screen.getByTestId('results-brand-review')).toBeTruthy());
    expect(screen.getByTestId('badge-section-score-voice-and-tone').textContent).toContain('4/5');
    expect(mocks.host.getItemReviewContent).toHaveBeenCalledWith('page-a', 'en');
    // The critical separation: AI analysis never executes workflow commands.
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
    expect(screen.queryByTestId('badge-review-stale')).toBeNull();
  });

  it('flags a review as stale as soon as the Page builder reports a content change', async () => {
    // Pin the page's __Updated to exactly the timestamp captured at review time.
    mocks.host.getItemWorkflowStatus.mockImplementation(async (itemId: string) =>
      makeStatus(itemId, { updatedAt: '2026-08-01T00:00:00Z' }),
    );
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('panel-brand-review-page-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('button-run-brand-review-page-a'));
    await waitFor(() => expect(screen.getByTestId('results-brand-review')).toBeTruthy());
    expect(screen.queryByTestId('badge-review-stale')).toBeNull();

    // The editor saves the page: the host now reports a newer __Updated, and
    // the panel's live content-update subscription refetches the status.
    mocks.host.getItemWorkflowStatus.mockImplementation(async (itemId: string) =>
      makeStatus(itemId, { updatedAt: '2026-08-02T00:00:00Z' }),
    );
    act(() => {
      for (const listener of mocks.updateListeners) listener();
    });
    await waitFor(() => expect(screen.getByTestId('badge-review-stale')).toBeTruthy());
    // Still purely advisory — nothing was executed.
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
  });

  it('drops the previous page review when the Page builder navigates', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('panel-brand-review-page-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('button-run-brand-review-page-a'));
    await waitFor(() => expect(screen.getByTestId('results-brand-review')).toBeTruthy());

    emitPage(makePage('page-b', 'Spring'));
    await waitFor(() => expect(screen.getByTestId('panel-brand-review-page-b')).toBeTruthy());
    expect(screen.queryByTestId('results-brand-review')).toBeNull();
  });

  it('refetches workflow status when the Page builder reports a content change', async () => {
    renderPanel();
    emitPage(makePage('page-a', 'Home'));
    await waitFor(() => expect(screen.getByTestId('text-workflow-name')).toBeTruthy());
    const before = mocks.host.getItemWorkflowStatus.mock.calls.length;

    act(() => {
      for (const listener of mocks.updateListeners) listener();
    });
    await waitFor(() =>
      expect(mocks.host.getItemWorkflowStatus.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
