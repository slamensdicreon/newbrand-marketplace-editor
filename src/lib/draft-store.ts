import type { SectionValues } from '@/lib/home-content';

/**
 * Session-scoped draft storage for in-progress section edits. This is the
 * safety net behind the unsaved-changes guards: even if the browser
 * navigates away (hardware back, tab restore, accidental refresh), the
 * editor restores the draft when the section is reopened in the same tab.
 * Nothing here ever touches Sitecore.
 */

const PREFIX = 'home-editor:draft:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // Storage can be unavailable in sandboxed iframes.
  }
}

export function saveDraft(
  sectionId: string,
  values: SectionValues,
  store: StorageLike | null = storage(),
): void {
  try {
    store?.setItem(PREFIX + sectionId, JSON.stringify(values));
  } catch {
    // Quota/security errors are non-fatal; the in-memory state still exists.
  }
}

export function loadDraft(
  sectionId: string,
  store: StorageLike | null = storage(),
): SectionValues | null {
  try {
    const raw = store?.getItem(PREFIX + sectionId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const values: SectionValues = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') values[k] = v;
    }
    return values;
  } catch {
    return null;
  }
}

export function clearDraft(
  sectionId: string,
  store: StorageLike | null = storage(),
): void {
  try {
    store?.removeItem(PREFIX + sectionId);
  } catch {
    // Ignore.
  }
}

/**
 * Remove every stored section draft. Used when the app switches from demo
 * data to a verified live Sitecore connection, so demo-era edits can never
 * be restored into (and then saved from) a live editing session.
 */
export function clearAllDrafts(store: StorageLike & { length?: number; key?: (i: number) => string | null } = window.sessionStorage): void {
  try {
    const keys: string[] = [];
    const length = store.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = store.key?.(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage can be unavailable in sandboxed iframes; non-fatal.
  }
}
