// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MarketplaceHost } from '@/lib/marketplace/host';

/**
 * Connection lifecycle tests: the app must render demo data immediately,
 * swap atomically to the live host on a successful handshake (dropping demo
 * caches), and stay in labeled demo mode with retry on failure.
 */

// Controllable embedding: standalone by default, embedded per-test.
const embedded = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/marketplace/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/marketplace/host')>();
  return { ...actual, isEmbedded: () => embedded.value };
});

// Controllable SDK handshake.
const sdk = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<MarketplaceHost>>(),
}));
vi.mock('@/lib/marketplace/sdk-host', () => ({
  SdkMarketplaceHost: { connect: () => sdk.connect() },
}));

import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { MarketplaceProvider, useMarketplace } from '@/lib/marketplace/provider';
import WorkflowBuilder from '@/pages/workflow-builder';

function liveHostStub(): MarketplaceHost & { destroyed: boolean } {
  return {
    mode: 'live',
    destroyed: false,
    getUser: async () => ({ name: 'Live Editor' }),
    listWorkflows: async () => [],
    getStateCounts: async () => ({}),
    getQueue: async () => ({ items: [], hasNextPage: false, endCursor: null }),
    getStateCommands: async () => [],
    getItemHistory: async () => [],
    executeCommand: async () => ({
      completed: true,
      successful: true,
      error: null,
      message: null,
      nextStateId: null,
    }),
    createDraftWorkflow: async () => ({ workflowId: 'wf' }),
    getWorkflowGraph: async () => ({ workflowId: 'wf', states: [], transitions: [] }),
    addState: async () => ({ stateId: 's' }),
    addTransition: async () => ({ commandId: 'c' }),
    deleteDefinitionItem: async () => undefined,
    getContentChildren: async () => [],
    getContentItems: async () => [],
    assignWorkflow: async () => [],
    subscribePageContext: () => () => undefined,
    subscribeContentUpdates: () => () => undefined,
    getItemWorkflowStatus: async () => null,
    getBrandReviewSupport: async () => ({ available: false, brandKitId: null, message: 'n/a' }),
    getItemReviewContent: async () => null,
    generateBrandReview: async () => [],
    destroy() {
      this.destroyed = true;
    },
  };
}

function Probe() {
  const { status, retry } = useMarketplace();
  return (
    <div>
      <span data-testid="state">{status.state}</span>
      <span data-testid="mode">{status.host.mode}</span>
      <span data-testid="reason">{status.state === 'demo' ? status.reason : ''}</span>
      <span data-testid="hostkey">{useMarketplace().hostKey}</span>
      <button data-testid="retry" onClick={retry}>
        retry
      </button>
    </div>
  );
}

let queryClient: QueryClient;

function renderProvider() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplaceProvider>
        <Probe />
      </MarketplaceProvider>
    </QueryClientProvider>,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function untilState(expected: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (screen.getByTestId('state').textContent === expected) return;
    await sleep(10);
  }
  throw new Error(
    `Timed out waiting for state "${expected}" (last: ${screen.getByTestId('state').textContent})`,
  );
}

beforeEach(() => {
  embedded.value = false;
  sdk.connect.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('MarketplaceProvider connection lifecycle', () => {
  it('standalone: shows demo data immediately without any handshake', async () => {
    renderProvider();
    expect(screen.getByTestId('state').textContent).toBe('demo');
    expect(screen.getByTestId('mode').textContent).toBe('demo');
    expect(screen.getByTestId('reason').textContent).toBe('standalone');
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('embedded: renders demo data while connecting, then swaps to live and drops demo caches', async () => {
    embedded.value = true;
    const live = liveHostStub();
    let resolveConnect!: (host: MarketplaceHost) => void;
    sdk.connect.mockReturnValue(new Promise((resolve) => (resolveConnect = resolve)));

    renderProvider();
    // Usable immediately, on demo data, while the handshake is pending.
    expect(screen.getByTestId('state').textContent).toBe('connecting');
    expect(screen.getByTestId('mode').textContent).toBe('demo');

    // Simulate a demo-era cache entry that must never reach the live session.
    queryClient.setQueryData(['workflows', 'demo'], [{ workflowId: 'demo-workflow' }]);

    resolveConnect(live);
    await untilState('live');
    expect(screen.getByTestId('mode').textContent).toBe('live');
    expect(queryClient.getQueryData(['workflows', 'demo'])).toBeUndefined();
  });

  it('embedded: stays usable in labeled demo mode when the handshake fails, and retry can go live', async () => {
    embedded.value = true;
    const live = liveHostStub();
    sdk.connect
      .mockRejectedValueOnce(new Error('SitecoreAI did not answer the connection handshake in time.'))
      .mockResolvedValueOnce(live);

    renderProvider();
    await untilState('demo');
    expect(screen.getByTestId('reason').textContent).toBe('unavailable');
    // Demo data remains available — the app is not blocked.
    expect(screen.getByTestId('mode').textContent).toBe('demo');

    fireEvent.click(screen.getByTestId('retry'));
    await untilState('live');
    expect(screen.getByTestId('mode').textContent).toBe('live');
  });

  it('every host generation gets a distinct cache key, so retries never share cached data', async () => {
    embedded.value = true;
    sdk.connect.mockRejectedValue(new Error('down'));

    renderProvider();
    await untilState('demo');
    const firstKey = screen.getByTestId('hostkey').textContent;
    expect(firstKey).toMatch(/^demo:\d+$/);

    fireEvent.click(screen.getByTestId('retry'));
    await sleep(30);
    await untilState('demo');
    const secondKey = screen.getByTestId('hostkey').textContent;
    expect(secondKey).toMatch(/^demo:\d+$/);
    // A stale completion from the first demo host would land under firstKey,
    // which nothing reads anymore.
    expect(secondKey).not.toBe(firstKey);
  });

  it('handoff: workflow-builder draft state composed against demo cannot survive into live', async () => {
    embedded.value = true;
    const live = liveHostStub();
    let resolveConnect!: (host: MarketplaceHost) => void;
    sdk.connect.mockReturnValue(new Promise((resolve) => (resolveConnect = resolve)));

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook } = memoryLocation({ path: '/builder' });
    // Mirror App's HostScopedRoutes: the routed tree is keyed by hostKey so
    // EVERY page's local state resets on host generation change.
    function KeyedRoutes() {
      const { hostKey } = useMarketplace();
      return (
        <Router hook={hook} key={hostKey}>
          <Route path="/builder" component={WorkflowBuilder} />
        </Router>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <MarketplaceProvider>
          <Probe />
          <KeyedRoutes />
        </MarketplaceProvider>
      </QueryClientProvider>,
    );

    let nameInput: HTMLInputElement | null = null;
    for (let i = 0; i < 200 && !nameInput; i++) {
      nameInput = document.querySelector<HTMLInputElement>('[data-testid="input-workflow-name"]');
      if (!nameInput) await sleep(10);
    }
    expect(nameInput, 'builder should render during connecting').toBeTruthy();
    fireEvent.change(nameInput!, { target: { value: 'DEMO DRAFT WORKFLOW' } });
    expect(nameInput!.value).toBe('DEMO DRAFT WORKFLOW');

    resolveConnect(live);
    await untilState('live');

    // The builder remounted for the live generation: the demo-era draft is gone.
    let fresh: HTMLInputElement | null = null;
    for (let i = 0; i < 200; i++) {
      fresh = document.querySelector<HTMLInputElement>('[data-testid="input-workflow-name"]');
      if (fresh && fresh.value === '') break;
      await sleep(10);
    }
    expect(fresh).toBeTruthy();
    expect(fresh!.value).toBe('');
  });

  it('?host=demo forces demo mode even when embedded', async () => {
    embedded.value = true;
    window.history.replaceState(null, '', '/?host=demo');
    renderProvider();
    expect(screen.getByTestId('state').textContent).toBe('demo');
    expect(screen.getByTestId('reason').textContent).toBe('standalone');
    expect(sdk.connect).not.toHaveBeenCalled();
  });
});
