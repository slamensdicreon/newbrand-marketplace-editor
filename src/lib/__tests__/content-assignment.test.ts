import { describe, expect, it } from 'vitest';
import {
  classifyTemplate,
  MAX_ASSIGN_SELECTION,
  normalizeId,
  resolveAssignmentTargets,
  validateSelection,
  type ContentItem,
} from '@/lib/workflow/types';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';

const host = () => new MockMarketplaceHost({ latencyMs: 0 });

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `{00000000-0000-4000-8000-${String(i).padStart(12, '0')}}`);
}

describe('validateSelection (bounded selection)', () => {
  it('rejects an empty selection', () => {
    expect(validateSelection([])).toHaveLength(1);
  });
  it('accepts up to the maximum', () => {
    expect(validateSelection(ids(MAX_ASSIGN_SELECTION))).toHaveLength(0);
  });
  it('rejects selections over the maximum — no apply-to-everything', () => {
    const problems = validateSelection(ids(MAX_ASSIGN_SELECTION + 1));
    expect(problems.join(' ')).toMatch(/Too many items/);
  });
  it('rejects duplicate ids even in different formats', () => {
    const a = '{AAAAAAAA-0000-4000-8000-000000000001}';
    const b = 'aaaaaaaa000040008000000000000001';
    expect(validateSelection([a, b]).join(' ')).toMatch(/duplicate/);
  });
});

describe('resolveAssignmentTargets (exact id resolution)', () => {
  const fresh = (id: string): ContentItem => ({
    itemId: normalizeId(id),
    name: 'X',
    path: '/x',
    templateName: 'Page',
    kind: 'page',
    hasChildren: false,
    language: 'en',
    version: 1,
    workflow: null,
    workflowState: null,
  });
  it('resolves ids present in fresh data and marks missing ones stale', () => {
    const [a, b, c] = ids(3);
    const { resolved, stale } = resolveAssignmentTargets([a!, b!, c!], [fresh(a!), fresh(c!)]);
    expect(resolved.map((r) => r.itemId)).toEqual([normalizeId(a!), normalizeId(c!)]);
    expect(stale).toEqual([normalizeId(b!)]);
  });
  it('never widens: fresh items not in the selection are ignored', () => {
    const [a, b] = ids(2);
    const { resolved } = resolveAssignmentTargets([a!], [fresh(a!), fresh(b!)]);
    expect(resolved).toHaveLength(1);
  });
});

describe('classifyTemplate', () => {
  it('classifies pages, folders and components', () => {
    expect(classifyTemplate('Landing Page')).toBe('page');
    expect(classifyTemplate('Data Folder')).toBe('folder');
    expect(classifyTemplate('Hero Section')).toBe('component');
    expect(classifyTemplate('Settings')).toBe('other');
  });
});

describe('MockMarketplaceHost content browsing & assignment', () => {
  it('exposes a root level with pages and drills into component content', async () => {
    const h = host();
    const root = await h.getContentChildren(null);
    expect(root.length).toBeGreaterThan(0);
    expect(root.some((i) => i.kind === 'page')).toBe(true);
    const home = root.find((i) => i.name === 'Home')!;
    const homeChildren = await h.getContentChildren(home.itemId);
    const data = homeChildren.find((i) => i.name === 'Data')!;
    const components = await h.getContentChildren(data.itemId);
    expect(components.some((i) => i.kind === 'component')).toBe(true);
    // Truthful workflow metadata on items.
    expect(components.find((i) => i.name === 'Hero Build')?.workflowState?.displayName).toBe('Draft');
  });

  it('getContentItems omits unknown ids instead of fabricating them', async () => {
    const h = host();
    const root = await h.getContentChildren(null);
    const known = root[0]!.itemId;
    const items = await h.getContentItems([known, '{DEADBEEF-0000-4000-8000-000000000000}']);
    expect(items.map((i) => i.itemId)).toEqual([known]);
  });

  it('assigns the workflow at its initial state and surfaces items in the queue', async () => {
    const h = host();
    const root = await h.getContentChildren(null);
    const about = root.find((i) => i.name === 'About')!;
    expect(about.workflow).toBeNull();
    const [wf] = await h.listWorkflows();
    const results = await h.assignWorkflow([about], wf!.workflowId);
    expect(results).toEqual([
      expect.objectContaining({ itemId: about.itemId, successful: true, error: null }),
    ]);
    const after = await h.getContentItems([about.itemId]);
    expect(after[0]!.workflow?.workflowId).toBe(wf!.workflowId);
    expect(after[0]!.workflowState?.displayName).toBe('Draft');
    const initial = wf!.states.find((s) => s.initial)!;
    const queue = await h.getQueue(wf!.workflowId, initial.stateId);
    expect(queue.items.some((i) => i.itemId === about.itemId)).toBe(true);
  });

  it('reports per-item partial failure for stale items without retrying', async () => {
    const h = host();
    const root = await h.getContentChildren(null);
    const about = root.find((i) => i.name === 'About')!;
    const ghost: ContentItem = { ...about, itemId: '{DEADBEEF-0000-4000-8000-000000000001}', name: 'Ghost' };
    const [wf] = await h.listWorkflows();
    const results = await h.assignWorkflow([about, ghost], wf!.workflowId);
    expect(results.find((r) => r.name === 'About')?.successful).toBe(true);
    const failed = results.find((r) => r.name === 'Ghost')!;
    expect(failed.successful).toBe(false);
    expect(failed.error).toMatch(/no longer exists/);
  });

  it('refuses oversized batches and unverified workflows (fail closed)', async () => {
    const h = host();
    const root = await h.getContentChildren(null);
    const item = root[0]!;
    const oversized = Array.from({ length: MAX_ASSIGN_SELECTION + 1 }, () => item);
    await expect(h.assignWorkflow(oversized, '{A5BC37E7-ED96-4C1E-8590-A26E64DB55EA}')).rejects.toThrow(
      /limit/,
    );
    await expect(
      h.assignWorkflow([item], '{11111111-2222-4333-8444-555555555555}'),
    ).rejects.toThrow(/could not be verified/);
  });
});
