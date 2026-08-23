import { describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('draft store', () => {
  it('round-trips drafts per section', () => {
    const store = memoryStore();
    saveDraft('services', { heading: 'DRAFT' }, store);
    expect(loadDraft('services', store)).toEqual({ heading: 'DRAFT' });
    expect(loadDraft('quote', store)).toBeNull();
  });

  it('clears drafts', () => {
    const store = memoryStore();
    saveDraft('services', { heading: 'DRAFT' }, store);
    clearDraft('services', store);
    expect(loadDraft('services', store)).toBeNull();
  });

  it('ignores corrupt or non-string payloads', () => {
    const store = memoryStore();
    store.setItem('home-editor:draft:services', 'not json');
    expect(loadDraft('services', store)).toBeNull();
    store.setItem('home-editor:draft:services', JSON.stringify({ a: 1, b: 'ok' }));
    expect(loadDraft('services', store)).toEqual({ b: 'ok' });
    store.setItem('home-editor:draft:services', JSON.stringify(['x']));
    expect(loadDraft('services', store)).toBeNull();
  });

  it('is safe with no storage available', () => {
    expect(() => saveDraft('services', { a: 'b' }, null)).not.toThrow();
    expect(loadDraft('services', null)).toBeNull();
    expect(() => clearDraft('services', null)).not.toThrow();
  });
});
