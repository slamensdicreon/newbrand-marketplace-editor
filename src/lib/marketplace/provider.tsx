import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentResult,
  ContentItem,
  DraftWorkflowSpec,
  ExecuteCommandArgs,
} from '@/lib/workflow/types';
import {
  MAX_ASSIGN_SELECTION,
  resolveAssignmentTargets,
  validateSelection,
} from '@/lib/workflow/types';
import { contentFingerprint, type BrandReviewResult } from '@/lib/workflow/brand-review';
import {
  isEmbedded,
  type ItemWorkflowStatus,
  type MarketplaceHost,
  type PageContextInfo,
} from './host';
import { MockMarketplaceHost } from './mock-host';
import { SdkMarketplaceHost } from './sdk-host';

/**
 * Connection lifecycle. A host is ALWAYS available — the app never blocks
 * on the Sitecore handshake:
 * - `connecting` — demo data is showing while the trusted Marketplace
 *   handshake runs in parallel.
 * - `live` — the handshake and API-resource verification succeeded; the
 *   demo host was destroyed, caches were dropped, and all
 *   traffic goes through the verified Sitecore host.
 * - `demo` — demo data only, either because the app runs standalone
 *   (Replit preview, local dev, `?host=demo`) or because the Sitecore
 *   connection failed (`reason: 'unavailable'`, retryable).
 *
 * There is no app-owned sign-in anywhere: the Sitecore Marketplace context
 * is the only source of identity, and the fail-closed origin checks in
 * `SdkMarketplaceHost.connect()` are unchanged.
 */
export type ConnectionStatus =
  | { state: 'connecting'; host: MarketplaceHost }
  | { state: 'live'; host: MarketplaceHost }
  | {
      state: 'demo';
      host: MarketplaceHost;
      reason: 'standalone' | 'unavailable';
      message?: string;
    };

interface MarketplaceContextValue {
  status: ConnectionStatus;
  /**
   * Unique key for the CURRENT host instance (e.g. `demo:1`, `live:2`).
   * Every query/mutation cache key includes it, so data fetched from one
   * host generation (a demo host, or a previous retry's host) can never be
   * served for another — even if `queryClient.clear()` races an in-flight
   * request whose completion repopulates its (now unread) old-generation key.
   */
  hostKey: string;
  retry: () => void;
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

/**
 * Mutable module-level mirror of the CURRENT host generation. Unlike
 * `useHostKey()` (a render-time snapshot), this is readable from inside a
 * long-running async mutation, so a guarded write can verify — immediately
 * before the write — that no host swap happened while it awaited. It is
 * updated synchronously at every generation change, including provider
 * teardown.
 */
let activeHostKey = 'none:0';
export function getActiveHostKey(): string {
  return activeHostKey;
}

/** True when a real Marketplace handshake should be attempted. */
function shouldAttemptLive(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('host') !== 'demo' && isEmbedded(window);
}

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [hostKey, setHostKey] = useState('none:0');
  const [attempt, setAttempt] = useState(0);
  const hostRef = useRef<MarketplaceHost | null>(null);
  const generationRef = useRef(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const nextKey = (mode: 'demo' | 'live'): string => {
      generationRef.current += 1;
      activeHostKey = `${mode}:${generationRef.current}`;
      return activeHostKey;
    };
    // Demo data renders immediately in every case; the handshake (when
    // applicable) runs in parallel and swaps the host in when verified.
    const demo = new MockMarketplaceHost();
    hostRef.current = demo;
    setHostKey(nextKey('demo'));

    if (!shouldAttemptLive()) {
      setStatus({ state: 'demo', host: demo, reason: 'standalone' });
      return () => {
        hostRef.current?.destroy();
        hostRef.current = null;
      };
    }

    setStatus({ state: 'connecting', host: demo });
    SdkMarketplaceHost.connect()
      .then((live) => {
        if (cancelled) {
          live.destroy();
          return;
        }
        // Atomic handoff: demo host is destroyed and every demo-era cache
        // is dropped BEFORE the live host is exposed, so
        // demo data can never leak into live reads or writes.
        demo.destroy();
        hostRef.current = live;
        queryClient.clear();
        setHostKey(nextKey('live'));
        setStatus({ state: 'live', host: live });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Failed to connect to the Sitecore host.';
        // Stay usable: keep the demo host, clearly labeled, with retry.
        setStatus({ state: 'demo', host: demo, reason: 'unavailable', message });
      });
    return () => {
      cancelled = true;
      // Invalidate the generation token so any still-running guarded
      // mutation from this generation refuses to write.
      generationRef.current += 1;
      activeHostKey = `none:${generationRef.current}`;
      hostRef.current?.destroy();
      hostRef.current = null;
    };
  }, [attempt, queryClient]);

  const retry = useCallback(() => {
    // A fresh attempt gets a fresh demo host; drop caches tied to the old one.
    queryClient.clear();
    setAttempt((n) => n + 1);
  }, [queryClient]);

  const value = useMemo(
    () => (status ? { status, hostKey, retry } : null),
    [status, hostKey, retry],
  );
  // The first effect pass sets status synchronously before paint; render
  // nothing for that single pre-effect render.
  if (!value) return null;
  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace(): MarketplaceContextValue {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error('useMarketplace must be used inside MarketplaceProvider');
  return ctx;
}

/** The active host. Demo while connecting/standalone/unavailable; live once verified. */
export function useHost(): MarketplaceHost {
  const { status } = useMarketplace();
  return status.host;
}

/** Cache key for the current host generation; changes on every host swap. */
export function useHostKey(): string {
  return useMarketplace().hostKey;
}

export function useEditorUser() {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['user', hostKey],
    queryFn: () => host!.getUser(),
    enabled: !!host,
    staleTime: Infinity,
  });
}

/* ---------------- Page builder companion hooks ---------------- */

export interface PageContextState {
  /** Page currently open in the Page builder; null when none/unknown. */
  page: PageContextInfo | null;
  /** False until the host has reported at least once. */
  ready: boolean;
}

/**
 * Live view of the page open in the Page builder. Resubscribes on every
 * host swap and never lets a previous generation's page leak through: the
 * state carries the hostKey it was produced under and is discarded when it
 * no longer matches.
 */
export function usePageContext(): PageContextState {
  const host = useHost();
  const hostKey = useHostKey();
  const [state, setState] = useState<{ key: string } & PageContextState>({
    key: hostKey,
    page: null,
    ready: false,
  });
  useEffect(() => {
    setState({ key: hostKey, page: null, ready: false });
    const unsubscribe = host.subscribePageContext((page) => {
      setState({ key: hostKey, page, ready: true });
    });
    return unsubscribe;
  }, [host, hostKey]);
  return state.key === hostKey ? state : { page: null, ready: false };
}

/**
 * Refresh callback wiring for Page builder content-change events
 * (fields/layout saved). Invalidates the given item's workflow status so
 * the panel never shows pre-save data.
 */
export function usePageContentUpdates(itemId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!itemId) return;
    return host.subscribeContentUpdates(() => {
      void queryClient.invalidateQueries({ queryKey: ['item-workflow-status', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-history'] });
    });
  }, [host, hostKey, itemId, queryClient]);
}

/** Fresh workflow placement of one item. */
export function useItemWorkflowStatus(itemId: string | undefined, language: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['item-workflow-status', itemId, language, hostKey],
    queryFn: () => host!.getItemWorkflowStatus(itemId!, language!),
    enabled: !!host && !!itemId && !!language,
  });
}

export type { ItemWorkflowStatus, PageContextInfo };

/* ---------------- Brand Review hooks (advisory only) ---------------- */

/** Whether Brand Review can run against the connected organization. */
export function useBrandReviewSupport() {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['brand-review-support', hostKey],
    queryFn: () => host!.getBrandReviewSupport(),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });
}

/**
 * Run a Brand Review analysis for one item. Purely advisory: the
 * resulting scores are shown to the reviewer and NEVER executed against
 * workflow commands. The mutation aborts (rather than reporting a result
 * for the wrong host) if the active host changes while it runs.
 */
export function useGenerateBrandReview() {
  const host = useHost();
  const hostKey = useHostKey();
  const { status } = useMarketplace();
  const isDemo = status.state !== 'live';
  return useMutation({
    mutationFn: async (args: { itemId: string; language: string }): Promise<BrandReviewResult> => {
      if (!host) throw new Error('Not connected.');
      const support = await host.getBrandReviewSupport();
      if (getActiveHostKey() !== hostKey) throw new Error('Connection changed. Try again.');
      if (!support.available || !support.brandKitId) {
        throw new Error(support.message ?? 'Brand Review is not available.');
      }
      const content = await host.getItemReviewContent(args.itemId, args.language);
      if (getActiveHostKey() !== hostKey) throw new Error('Connection changed. Try again.');
      if (!content) throw new Error('The item could not be read.');
      if (content.entries.length === 0) {
        throw new Error('This item has no reviewable text content.');
      }
      const sections = await host.generateBrandReview(support.brandKitId, content);
      if (getActiveHostKey() !== hostKey) throw new Error('Connection changed. Try again.');
      return {
        generatedAt: new Date().toISOString(),
        fingerprint: contentFingerprint(content),
        contentUpdatedAt: content.updatedAt,
        demo: isDemo,
        truncated: content.truncated,
        sections,
      };
    },
  });
}

/* ---------------- Workflow hooks ---------------- */

export function useWorkflows() {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['workflows', hostKey],
    queryFn: () => host!.listWorkflows(),
    enabled: !!host,
    staleTime: 60_000,
  });
}

/** Stable signature of a state-id set for cache keys. */
export function stateIdsKey(stateIds: string[]): string {
  return [...stateIds].sort().join(',');
}

export function useStateCounts(workflowId: string | undefined, stateIds: string[]) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    // Keyed by the state-id set so a newly added/removed state never
    // serves counts computed for the previous definition.
    queryKey: ['workflow-counts', workflowId, stateIdsKey(stateIds), hostKey],
    queryFn: () => host!.getStateCounts(workflowId!, stateIds),
    enabled: !!host && !!workflowId && stateIds.length > 0,
  });
}

export function useWorkflowQueue(workflowId: string | undefined, stateId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  return useInfiniteQuery({
    queryKey: ['workflow-queue', workflowId, stateId, hostKey],
    queryFn: ({ pageParam }) => host!.getQueue(workflowId!, stateId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.endCursor : null),
    enabled: !!host && !!workflowId && !!stateId,
  });
}

export function useStateCommands(workflowId: string | undefined, stateId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['workflow-commands', workflowId, stateId, hostKey],
    queryFn: () => host!.getStateCommands(workflowId!, stateId!),
    enabled: !!host && !!workflowId && !!stateId,
    staleTime: 60_000,
  });
}

export function useItemHistory(
  workflowId: string | undefined,
  itemId: string | undefined,
  language: string,
) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['workflow-history', workflowId, itemId, language, hostKey],
    queryFn: () => host!.getItemHistory(workflowId!, itemId!, language),
    enabled: !!host && !!workflowId && !!itemId,
  });
}

/**
 * Execute a workflow command. On success the queue, counts and history
 * caches for the workflow are invalidated so the UI reflects the move.
 */
export function useExecuteCommand(workflowId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: ExecuteCommandArgs) => {
      if (!host) throw new Error('Not connected.');
      const result = await host.executeCommand(args);
      if (!result.successful) {
        throw new Error(result.error || 'Sitecore rejected the workflow command.');
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-queue', workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-counts', workflowId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-history', workflowId] });
    },
  });
}

export function useWorkflowGraph(workflowId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['workflow-graph', workflowId, hostKey],
    queryFn: () => host!.getWorkflowGraph(workflowId!),
    enabled: !!host && !!workflowId,
    staleTime: 60_000,
  });
}

function useInvalidateDefinitions() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-graph'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-commands'] });
  };
}

export function useAddState() {
  const host = useHost();
  const hostKey = useHostKey();
  const invalidate = useInvalidateDefinitions();
  return useMutation({
    mutationFn: async (args: { workflowId: string; name: string; final: boolean }) => {
      if (!host) throw new Error('Not connected.');
      return host.addState(args.workflowId, args.name, args.final);
    },
    onSuccess: invalidate,
  });
}

export function useAddTransition() {
  const host = useHost();
  const hostKey = useHostKey();
  const invalidate = useInvalidateDefinitions();
  return useMutation({
    mutationFn: async (args: { fromStateId: string; name: string; toStateId: string }) => {
      if (!host) throw new Error('Not connected.');
      return host.addTransition(args.fromStateId, args.name, args.toStateId);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDefinitionItem() {
  const host = useHost();
  const hostKey = useHostKey();
  const invalidate = useInvalidateDefinitions();
  return useMutation({
    mutationFn: async (args: { itemId: string }) => {
      if (!host) throw new Error('Not connected.');
      await host.deleteDefinitionItem(args.itemId);
    },
    onSuccess: invalidate,
  });
}

/** Children of one content node (or the content root when null). */
export function useContentChildren(parentId: string | null) {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['content-children', parentId ?? 'root', hostKey],
    queryFn: () => host!.getContentChildren(parentId),
    enabled: !!host,
    staleTime: 30_000,
  });
}

export interface AssignWorkflowOutcome {
  results: AssignmentResult[];
  /** Selected item ids that no longer resolved against fresh host data. */
  stale: Array<{ itemId: string; name: string; path: string }>;
}

/**
 * Guarded workflow assignment: validates the bounded selection, re-resolves
 * every target id against FRESH host data immediately before applying, and
 * returns per-item results plus stale items. Never retries or widens.
 */
export function useAssignWorkflow(workflowId: string | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (selected: ContentItem[]): Promise<AssignWorkflowOutcome> => {
      if (!host || !workflowId) throw new Error('Not connected.');
      const ids = selected.map((i) => i.itemId);
      const problems = validateSelection(ids);
      if (problems.length > 0) throw new Error(problems.join(' '));
      const fresh = await host.getContentItems(ids);
      const { resolved, stale } = resolveAssignmentTargets(ids, fresh);
      const staleDetails = stale.map((id) => {
        const original = selected.find((i) => i.itemId === id);
        return {
          itemId: id,
          name: original?.name ?? id,
          path: original?.path ?? 'unknown path',
        };
      });
      const results =
        resolved.length > 0 ? await host.assignWorkflow(resolved, workflowId) : [];
      return { results, stale: staleDetails };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content-children'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-history'] });
    },
  });
}

export { MAX_ASSIGN_SELECTION };

export function useCreateWorkflow() {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (spec: DraftWorkflowSpec) => {
      if (!host) throw new Error('Not connected.');
      return host.createDraftWorkflow(spec);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
