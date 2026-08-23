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
import {
  getSection,
  validateSection,
  type SectionDefinition,
  type SectionValues,
} from '@/lib/home-content';
import type { DraftWorkflowSpec, ExecuteCommandArgs } from '@/lib/workflow/types';
import { clearAllDrafts } from '@/lib/draft-store';
import { isEmbedded, type MarketplaceHost } from './host';
import { MockMarketplaceHost } from './mock-host';
import { SdkMarketplaceHost } from './sdk-host';

/**
 * Connection lifecycle. A host is ALWAYS available — the app never blocks
 * on the Sitecore handshake:
 * - `connecting` — demo data is showing while the trusted Marketplace
 *   handshake runs in parallel.
 * - `live` — the handshake and API-resource verification succeeded; the
 *   demo host was destroyed, caches and demo drafts were dropped, and all
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
      return `${mode}:${generationRef.current}`;
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
        // and local draft is dropped BEFORE the live host is exposed, so
        // demo data can never leak into live reads or writes.
        demo.destroy();
        hostRef.current = live;
        clearAllDrafts();
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

export function useSiteSummary() {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['site', hostKey],
    queryFn: () => host!.getSite(),
    enabled: !!host,
    staleTime: Infinity,
  });
}

export function useSectionContent(sectionId: string) {
  const host = useHost();
  const hostKey = useHostKey();
  const section = getSection(sectionId);
  return useQuery({
    queryKey: ['section', sectionId, hostKey],
    queryFn: () => host!.loadSection(section!),
    enabled: !!host && !!section,
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

/**
 * Save changed fields for a section. Validates before sending; on success
 * the section cache is updated in place so the UI reflects the new values
 * without a refetch.
 */
export function useSaveSection(section: SectionDefinition | undefined) {
  const host = useHost();
  const hostKey = useHostKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changed: SectionValues) => {
      if (!host || !section) throw new Error('Not connected.');
      const current =
        queryClient.getQueryData<SectionValues>(['section', section.id, hostKey]) ?? {};
      const next = { ...current, ...changed };
      const errors = validateSection(section, next);
      if (errors.length > 0) {
        throw new Error(errors.map((e) => e.message).join(' '));
      }
      await host.saveSection(section, changed);
      return next;
    },
    onSuccess: (next) => {
      if (host && section) {
        queryClient.setQueryData(['section', section.id, hostKey], next);
      }
    },
  });
}
