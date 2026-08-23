/**
 * Session-scoped log of workflow actions executed from this app. Gives
 * reviewers a visible trail of what they changed without pretending to be
 * Sitecore's audit history (the item's real history stays in Sitecore).
 */

export interface ActionLogEntry {
  at: string;
  itemName: string;
  itemPath: string;
  command: string;
  fromState: string;
  toState: string | null;
  comments: string | null;
}

const KEY = 'workflow-ops:action-log';
const MAX_ENTRIES = 50;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readActionLog(store: StorageLike | null = storage()): ActionLogEntry[] {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ActionLogEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as ActionLogEntry).at === 'string' &&
        typeof (e as ActionLogEntry).command === 'string',
    );
  } catch {
    return [];
  }
}

export function appendActionLog(
  entry: ActionLogEntry,
  store: StorageLike | null = storage(),
): ActionLogEntry[] {
  const entries = [entry, ...readActionLog(store)].slice(0, MAX_ENTRIES);
  try {
    store?.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota/security errors are non-fatal.
  }
  return entries;
}
