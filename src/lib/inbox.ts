import { useQuery } from '@tanstack/react-query';
import { useHost, useHostKey } from '@/lib/marketplace/provider';
import type { MarketplaceHost } from '@/lib/marketplace/host';
import {
  ageBucket,
  formatAge,
  normalizeId,
  type AgeBucket,
  type QueueItem,
  type WorkflowCommandInfo,
  type WorkflowInfo,
  type WorkflowStateInfo,
} from '@/lib/workflow/types';

export interface WorkInboxEntry {
  key: string;
  workflow: WorkflowInfo;
  state: WorkflowStateInfo;
  item: QueueItem;
  commands: WorkflowCommandInfo[];
  urgency: AgeBucket;
  reason: string;
}

export interface WorkInboxRemainder {
  workflow: WorkflowInfo;
  state: WorkflowStateInfo;
  remaining: number;
}

export interface WorkInboxData {
  entries: WorkInboxEntry[];
  remainders: WorkInboxRemainder[];
}

const urgencyRank: Record<AgeBucket, number> = {
  stale: 0,
  aging: 1,
  fresh: 2,
  unknown: 3,
};

export function inboxItemKey(
  item: Pick<QueueItem, 'itemId' | 'language' | 'version'>,
  workflowId = '',
  stateId = '',
): string {
  return [workflowId, stateId, item.itemId, item.language, item.version ?? ''].join('::');
}

export function compareInboxEntries(a: WorkInboxEntry, b: WorkInboxEntry): number {
  const bucket = urgencyRank[a.urgency] - urgencyRank[b.urgency];
  if (bucket !== 0) return bucket;
  const at = a.item.updatedAt ? new Date(a.item.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  const bt = b.item.updatedAt ? new Date(b.item.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  return at - bt;
}

/** Commands shared by every entry, matched only by Sitecore command id. */
export function intersectCommands(entries: WorkInboxEntry[]): WorkflowCommandInfo[] {
  if (entries.length === 0) return [];
  return entries[0]!.commands.filter((command) =>
    entries.slice(1).every((entry) =>
      entry.commands.some((candidate) => candidate.commandId === command.commandId),
    ),
  );
}

export function prioritizationReason(
  urgency: AgeBucket,
  updatedAt: string | null,
  stateName: string,
): string {
  const prefix =
    urgency === 'stale'
      ? 'Stale'
      : urgency === 'aging'
        ? 'Aging'
        : urgency === 'fresh'
          ? 'Fresh'
          : 'Age unknown';
  return urgency === 'unknown'
    ? `${prefix} — in ${stateName}`
    : `${prefix} — ${formatAge(updatedAt)} in ${stateName}`;
}

/** Safety cap so a pathological queue can never turn one write into an unbounded scan. */
export const MAX_MEMBERSHIP_PAGES = 40;

export type QueueMembership = 'present' | 'absent' | 'unresolved';

/**
 * Authoritatively resolve whether one selected identity is still in its state
 * by walking the queue's pages. Returns 'absent' only after the full queue has
 * been read; if the page cap is hit first, returns 'unresolved' so the caller
 * can skip the write with a precise reason instead of guessing either way.
 */
export async function resolveQueueMembership(
  host: Pick<MarketplaceHost, 'getQueue'>,
  workflowId: string,
  stateId: string,
  itemKey: string,
  maxPages = MAX_MEMBERSHIP_PAGES,
): Promise<QueueMembership> {
  let after: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await host.getQueue(workflowId, stateId, after);
    if (result.items.some((item) => inboxItemKey(item) === itemKey)) return 'present';
    if (!result.hasNextPage || !result.endCursor) return 'absent';
    after = result.endCursor;
  }
  return 'unresolved';
}

/**
 * First-page-only cross-workflow aggregation. Sitecore remains authoritative:
 * this composes existing reads and never broadens their contracts.
 */
export function useWorkInbox() {
  const host = useHost();
  const hostKey = useHostKey();
  return useQuery({
    queryKey: ['work-inbox', hostKey],
    queryFn: async (): Promise<WorkInboxData> => {
      const workflows = await host.listWorkflows();
      const states = workflows.flatMap((workflow) =>
        workflow.states.filter((state) => !state.final).map((state) => ({ workflow, state })),
      );
      const groups = await Promise.all(
        states.map(async ({ workflow, state }) => {
          const [page, commands, counts] = await Promise.all([
            host.getQueue(workflow.workflowId, state.stateId, null),
            host.getStateCommands(workflow.workflowId, state.stateId),
            host.getStateCounts(workflow.workflowId, [state.stateId]),
          ]);
          const total = counts[normalizeId(state.stateId)] ?? page.items.length;
          return { workflow, state, page, commands, total };
        }),
      );
      const entries = groups
        .flatMap(({ workflow, state, page, commands }) =>
          page.items.map((item) => {
            const urgency = ageBucket(item.updatedAt);
            return {
              key: inboxItemKey(item, workflow.workflowId, state.stateId),
              workflow,
              state,
              item,
              commands,
              urgency,
              reason: prioritizationReason(urgency, item.updatedAt, state.displayName),
            };
          }),
        )
        .sort(compareInboxEntries);
      const remainders = groups
        .filter(({ total, page }) => total > page.items.length)
        .map(({ workflow, state, total, page }) => ({
          workflow,
          state,
          remaining: total - page.items.length,
        }));
      return { entries, remainders };
    },
  });
}