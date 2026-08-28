import { describe, expect, it } from 'vitest';
import {
  contentFingerprint,
  extractPlainText,
  isReviewStale,
  isReviewableFieldName,
  limitReviewEntries,
  overallScore,
  sectionTitle,
  MAX_ENTRY_CHARS,
  MAX_REVIEW_CHARS,
  MAX_REVIEW_ENTRIES,
  type ReviewContent,
  type ReviewContentEntry,
} from '@/lib/workflow/brand-review';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';

function entry(label: string, text: string): ReviewContentEntry {
  return { source: 'field', label, text };
}

function content(entries: ReviewContentEntry[]): ReviewContent {
  return {
    itemId: 'item-1',
    language: 'en',
    version: 1,
    updatedAt: '2026-08-01T00:00:00Z',
    entries,
    truncated: false,
  };
}

describe('extractPlainText', () => {
  it('strips markup and entities', () => {
    expect(extractPlainText('<p>Hello&nbsp;<b>world</b> &amp; more</p>')).toBe(
      'Hello world & more',
    );
  });
  it('drops GUID-only values (no reviewable copy)', () => {
    expect(extractPlainText('{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}')).toBe('');
    expect(extractPlainText(null)).toBe('');
  });
});

describe('isReviewableFieldName', () => {
  it('excludes system fields', () => {
    expect(isReviewableFieldName('__Updated')).toBe(false);
    expect(isReviewableFieldName('Title')).toBe(true);
  });
});

describe('limitReviewEntries', () => {
  it('keeps short entries untouched', () => {
    const result = limitReviewEntries([entry('Title', 'Hello')]);
    expect(result.truncated).toBe(false);
    expect(result.entries).toHaveLength(1);
  });
  it('clips long entries and reports truncation', () => {
    const result = limitReviewEntries([entry('Body', 'x'.repeat(MAX_ENTRY_CHARS + 100))]);
    expect(result.truncated).toBe(true);
    expect(result.entries[0].text).toHaveLength(MAX_ENTRY_CHARS);
  });
  it('drops entries beyond the entry cap', () => {
    const many = Array.from({ length: MAX_REVIEW_ENTRIES + 5 }, (_, i) => entry(`f${i}`, 'text'));
    const result = limitReviewEntries(many);
    expect(result.entries).toHaveLength(MAX_REVIEW_ENTRIES);
    expect(result.truncated).toBe(true);
  });
  it('never exceeds the total character budget', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entry(`f${i}`, 'y'.repeat(MAX_ENTRY_CHARS)),
    );
    const result = limitReviewEntries(many);
    const total = result.entries.reduce((sum, e) => sum + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_REVIEW_CHARS);
    expect(result.truncated).toBe(true);
  });
  it('skips empty entries', () => {
    const result = limitReviewEntries([entry('Empty', '   '), entry('Title', 'Hi')]);
    expect(result.entries).toHaveLength(1);
  });
});

describe('contentFingerprint', () => {
  it('is stable for identical content and changes when text changes', () => {
    const a = contentFingerprint(content([entry('Title', 'Hello')]));
    const b = contentFingerprint(content([entry('Title', 'Hello')]));
    const c = contentFingerprint(content([entry('Title', 'Hello!')]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('overallScore', () => {
  it('is the lowest section score (conservative)', () => {
    expect(
      overallScore([
        { sectionId: 'a', score: 4, reason: '', suggestion: '', fields: [] },
        { sectionId: 'b', score: 2, reason: '', suggestion: '', fields: [] },
      ]),
    ).toBe(2);
    expect(overallScore([])).toBeNull();
  });
});

describe('isReviewStale', () => {
  it('is stale exactly when the updated timestamp changed', () => {
    const review = { contentUpdatedAt: '2026-08-01T00:00:00Z' };
    expect(isReviewStale(review, '2026-08-01T00:00:00Z')).toBe(false);
    expect(isReviewStale(review, '2026-08-02T00:00:00Z')).toBe(true);
    expect(isReviewStale({ contentUpdatedAt: null }, null)).toBe(false);
  });
});

describe('sectionTitle', () => {
  it('humanizes section ids', () => {
    expect(sectionTitle('voice-and-tone')).toBe('Voice and tone');
  });
});

describe('MockMarketplaceHost brand review (demo)', () => {
  it('reports availability with a demo brand kit', async () => {
    const host = new MockMarketplaceHost({ latencyMs: 0 });
    const support = await host.getBrandReviewSupport();
    expect(support.available).toBe(true);
    expect(support.brandKitId).toBeTruthy();
  });

  it('produces deterministic sample results for identical content', async () => {
    const host = new MockMarketplaceHost({ latencyMs: 0 });
    const c = content([entry('Title', 'Hello world')]);
    const first = await host.generateBrandReview('kit', c);
    const second = await host.generateBrandReview('kit', c);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    for (const section of first) {
      expect(section.score).toBeGreaterThanOrEqual(1);
      expect(section.score).toBeLessThanOrEqual(5);
      // Every demo result is explicit that it is a sample, not live AI.
      expect(section.reason).toMatch(/demo/i);
    }
  });

  it('gathers bounded demo content for a queue item', async () => {
    const host = new MockMarketplaceHost({ latencyMs: 0 });
    const workflows = await host.listWorkflows();
    const wf = workflows[0];
    const state = wf.states.find((s) => !s.final)!;
    const queue = await host.getQueue(wf.workflowId, state.stateId, null);
    const item = queue.items[0];
    const gathered = await host.getItemReviewContent(item.itemId, item.language);
    expect(gathered).not.toBeNull();
    expect(gathered!.entries.length).toBeGreaterThan(0);
    expect(gathered!.itemId).toBe(item.itemId);
    expect(gathered!.updatedAt).toBe(item.updatedAt);
  });

  it('returns null for unknown items', async () => {
    const host = new MockMarketplaceHost({ latencyMs: 0 });
    expect(await host.getItemReviewContent('{DOES-NOT-EXIST}', 'en')).toBeNull();
  });
});
