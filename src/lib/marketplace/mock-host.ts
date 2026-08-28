import type {
  EditorUser,
  ItemWorkflowStatus,
  MarketplaceHost,
  PageContextInfo,
} from './host';
import {
  classifyTemplate,
  normalizeId,
  validateDraftWorkflow,
  MAX_ASSIGN_SELECTION,
  type AssignmentResult,
  type CommandResult,
  type ContentItem,
  type DraftWorkflowSpec,
  type ExecuteCommandArgs,
  type QueueItem,
  type QueuePage,
  type StateCounts,
  type WorkflowCommandInfo,
  type WorkflowGraph,
  type WorkflowHistoryEvent,
  type WorkflowInfo,
  type WorkflowTransitionInfo,
} from '@/lib/workflow/types';
import {
  contentFingerprint,
  limitReviewEntries,
  type BrandReviewSectionResult,
  type BrandReviewSupport,
  type ReviewContent,
} from '@/lib/workflow/brand-review';

/** Demo brand kit id shown in demo mode; not a real Sitecore brand kit. */
const DEMO_BRAND_KIT_ID = '{DEMO0000-BRAND-KIT0-0000-000000000000}';

/**
 * Demo host for local preview. The Replit preview does not run inside
 * SitecoreAI, so there is no Marketplace handshake available; this host
 * serves faithful in-memory workflow and content-browser fixtures. The UI
 * shows a persistent "Demo mode" indicator whenever this host is active.
 */

const LATENCY_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockMarketplaceHost implements MarketplaceHost {
  readonly mode = 'demo' as const;
  private latencyMs: number;

  constructor(options?: { latencyMs?: number }) {
    this.latencyMs = options?.latencyMs ?? LATENCY_MS;
  }

  async getUser(): Promise<EditorUser> {
    await delay(this.latencyMs);
    return { name: 'Demo Editor', email: 'demo.editor@example.com' };
  }

  /* ---------------- Workflow operations (demo data) ---------------- */

  private workflows: WorkflowInfo[] = demoWorkflows();
  private queueItems: Map<string, DemoQueueItem[]> = demoQueueItems();
  private commandsByState: Map<string, WorkflowCommandInfo[]> = demoCommands();
  private historyByItem: Map<string, WorkflowHistoryEvent[]> = demoHistory();
  private transitions: Map<string, WorkflowTransitionInfo[]> = demoTransitions();

  async listWorkflows(): Promise<WorkflowInfo[]> {
    await delay(this.latencyMs);
    return this.workflows.map((wf) => ({ ...wf, states: wf.states.map((s) => ({ ...s })) }));
  }

  async getStateCounts(workflowId: string, stateIds: string[]): Promise<StateCounts> {
    await delay(this.latencyMs);
    const counts: StateCounts = {};
    for (const stateId of stateIds) {
      const key = queueKey(workflowId, stateId);
      counts[normalizeId(stateId)] = this.queueItems.get(key)?.length ?? 0;
    }
    return counts;
  }

  async getQueue(workflowId: string, stateId: string, after?: string | null): Promise<QueuePage> {
    await delay(this.latencyMs);
    const items = this.queueItems.get(queueKey(workflowId, stateId)) ?? [];
    const start = after ? Number(after) : 0;
    const pageSize = 3;
    const page = items.slice(start, start + pageSize);
    const next = start + page.length;
    return {
      items: page.map((i) => ({ ...i.item })),
      hasNextPage: next < items.length,
      endCursor: next < items.length ? String(next) : null,
    };
  }

  async getStateCommands(workflowId: string, stateId: string): Promise<WorkflowCommandInfo[]> {
    await delay(this.latencyMs);
    return (this.commandsByState.get(queueKey(workflowId, stateId)) ?? []).map((c) => ({ ...c }));
  }

  async getItemHistory(
    _workflowId: string,
    itemId: string,
    _language: string,
  ): Promise<WorkflowHistoryEvent[]> {
    await delay(this.latencyMs);
    return (this.historyByItem.get(normalizeId(itemId)) ?? []).map((e) => ({
      ...e,
      comments: [...e.comments],
    }));
  }

  async executeCommand(args: ExecuteCommandArgs): Promise<CommandResult> {
    await delay(this.latencyMs);
    for (const [key, items] of this.queueItems) {
      const index = items.findIndex((i) => i.item.itemId === normalizeId(args.itemId));
      if (index === -1) continue;
      const [workflowId, stateId] = splitQueueKey(key);
      const command = (this.commandsByState.get(key) ?? []).find(
        (c) => c.commandId === normalizeId(args.commandId),
      );
      if (!command) {
        return {
          completed: false,
          successful: false,
          error: 'That command is not available from the item’s current state.',
          message: null,
          nextStateId: null,
        };
      }
      const entry = items[index]!;
      const nextStateId = entry.nextStateByCommand[command.commandId];
      if (!nextStateId) {
        return {
          completed: false,
          successful: false,
          error: 'Demo mode does not define a target state for this command.',
          message: null,
          nextStateId: null,
        };
      }
      items.splice(index, 1);
      const targetKey = queueKey(workflowId, nextStateId);
      const moved: DemoQueueItem = {
        item: { ...entry.item, updatedAt: new Date().toISOString(), updatedBy: 'sitecore\\demo.editor' },
        nextStateByCommand: {},
      };
      this.queueItems.set(targetKey, [...(this.queueItems.get(targetKey) ?? []), moved]);
      const wf = this.workflows.find((w) => w.workflowId === workflowId);
      const oldName = wf?.states.find((s) => s.stateId === stateId)?.displayName ?? null;
      const newName = wf?.states.find((s) => s.stateId === nextStateId)?.displayName ?? null;
      const history = this.historyByItem.get(entry.item.itemId) ?? [];
      history.push({
        date: new Date().toISOString(),
        user: 'sitecore\\demo.editor',
        oldState: oldName,
        newState: newName,
        comments: args.comments?.trim() ? [args.comments.trim()] : [],
      });
      this.historyByItem.set(entry.item.itemId, history);
      return {
        completed: true,
        successful: true,
        error: null,
        message: null,
        nextStateId,
      };
    }
    return {
      completed: false,
      successful: false,
      error: 'Item not found in any demo workflow queue.',
      message: null,
      nextStateId: null,
    };
  }

  async createDraftWorkflow(spec: DraftWorkflowSpec): Promise<{ workflowId: string }> {
    await delay(this.latencyMs);
    const problems = validateDraftWorkflow(spec);
    if (problems.length > 0) {
      throw new Error(problems.join(' '));
    }
    const workflowId = randomDemoId();
    const stateIds = new Map(spec.states.map((s) => [s.key, randomDemoId()] as const));
    this.workflows = [
      ...this.workflows,
      {
        workflowId,
        displayName: spec.name.trim(),
        states: spec.states.map((s) => ({
          stateId: stateIds.get(s.key)!,
          displayName: s.name.trim(),
          final: s.final,
          initial: s.initial,
        })),
      },
    ];
    for (const state of spec.states) {
      this.queueItems.set(queueKey(workflowId, stateIds.get(state.key)!), []);
    }
    const createdTransitions: WorkflowTransitionInfo[] = [];
    for (const t of spec.transitions) {
      const fromStateId = stateIds.get(t.fromKey)!;
      const key = queueKey(workflowId, fromStateId);
      const commands = this.commandsByState.get(key) ?? [];
      const commandId = randomDemoId();
      commands.push({ commandId, displayName: t.name.trim(), suppressComments: false });
      this.commandsByState.set(key, commands);
      createdTransitions.push({
        commandId,
        displayName: t.name.trim(),
        fromStateId,
        toStateId: stateIds.get(t.toKey)!,
      });
    }
    this.transitions.set(workflowId, createdTransitions);
    return { workflowId };
  }

  /* ------------- Definition management (demo, in-memory) ------------- */

  async getWorkflowGraph(workflowId: string): Promise<WorkflowGraph> {
    await delay(this.latencyMs);
    const id = normalizeId(workflowId);
    const wf = this.workflows.find((w) => w.workflowId === id);
    if (!wf) throw new Error('This workflow definition could not be read.');
    return {
      workflowId: id,
      states: wf.states.map((s) => ({ ...s })),
      transitions: (this.transitions.get(id) ?? []).map((t) => ({ ...t })),
    };
  }

  async addState(
    workflowId: string,
    name: string,
    final: boolean,
  ): Promise<{ stateId: string }> {
    await delay(this.latencyMs);
    const wf = this.workflows.find((w) => w.workflowId === normalizeId(workflowId));
    if (!wf) throw new Error('Unknown workflow.');
    const stateId = randomDemoId();
    wf.states.push({ stateId, displayName: name.trim(), final, initial: false });
    this.queueItems.set(queueKey(wf.workflowId, stateId), []);
    return { stateId };
  }

  async addTransition(
    fromStateId: string,
    name: string,
    toStateId: string,
  ): Promise<{ commandId: string }> {
    await delay(this.latencyMs);
    const wf = this.workflows.find((w) =>
      w.states.some((s) => s.stateId === normalizeId(fromStateId)),
    );
    if (!wf) throw new Error('Unknown source state.');
    const commandId = randomDemoId();
    const key = queueKey(wf.workflowId, fromStateId);
    this.commandsByState.set(key, [
      ...(this.commandsByState.get(key) ?? []),
      { commandId, displayName: name.trim(), suppressComments: false },
    ]);
    this.transitions.set(wf.workflowId, [
      ...(this.transitions.get(wf.workflowId) ?? []),
      {
        commandId,
        displayName: name.trim(),
        fromStateId: normalizeId(fromStateId),
        toStateId: normalizeId(toStateId),
      },
    ]);
    // Existing queue items in the source state can now take this command.
    for (const entry of this.queueItems.get(key) ?? []) {
      entry.nextStateByCommand[commandId] = normalizeId(toStateId);
    }
    return { commandId };
  }

  async deleteDefinitionItem(itemId: string): Promise<void> {
    await delay(this.latencyMs);
    const id = normalizeId(itemId);
    // Workflow?
    const wfIndex = this.workflows.findIndex((w) => w.workflowId === id);
    if (wfIndex !== -1) {
      const wf = this.workflows[wfIndex]!;
      for (const state of wf.states) this.queueItems.delete(queueKey(id, state.stateId));
      this.workflows.splice(wfIndex, 1);
      this.transitions.delete(id);
      return;
    }
    // State?
    for (const wf of this.workflows) {
      const stateIndex = wf.states.findIndex((s) => s.stateId === id);
      if (stateIndex !== -1) {
        wf.states.splice(stateIndex, 1);
        this.queueItems.delete(queueKey(wf.workflowId, id));
        this.commandsByState.delete(queueKey(wf.workflowId, id));
        this.transitions.set(
          wf.workflowId,
          (this.transitions.get(wf.workflowId) ?? []).filter((t) => t.fromStateId !== id),
        );
        return;
      }
    }
    // Command?
    for (const [wfId, transitions] of this.transitions) {
      const t = transitions.find((x) => x.commandId === id);
      if (!t) continue;
      this.transitions.set(
        wfId,
        transitions.filter((x) => x.commandId !== id),
      );
      const key = queueKey(wfId, t.fromStateId);
      this.commandsByState.set(
        key,
        (this.commandsByState.get(key) ?? []).filter((c) => c.commandId !== id),
      );
      for (const entry of this.queueItems.get(key) ?? []) {
        delete entry.nextStateByCommand[id];
      }
      return;
    }
    throw new Error('Item not found in any demo workflow definition.');
  }

  /* ---------- Content browsing & workflow assignment (demo) ---------- */

  private contentTree: Map<string | null, DemoContentNode[]> = demoContentTree();

  private findContentNode(itemId: string): DemoContentNode | null {
    const id = normalizeId(itemId);
    for (const nodes of this.contentTree.values()) {
      const node = nodes.find((n) => n.item.itemId === id);
      if (node) return node;
    }
    return null;
  }

  private decorateWorkflow(item: ContentItem): ContentItem {
    // Resolve workflow/state display names against the current definitions.
    if (!item.workflow) return { ...item, workflow: null, workflowState: null };
    const wf = this.workflows.find((w) => w.workflowId === item.workflow!.workflowId);
    const state = wf?.states.find((s) => s.stateId === item.workflowState?.stateId);
    return {
      ...item,
      workflow: wf
        ? { workflowId: wf.workflowId, displayName: wf.displayName }
        : { ...item.workflow },
      workflowState: item.workflowState
        ? { stateId: item.workflowState.stateId, displayName: state?.displayName ?? item.workflowState.displayName }
        : null,
    };
  }

  async getContentChildren(parentId: string | null): Promise<ContentItem[]> {
    await delay(this.latencyMs);
    const key = parentId ? normalizeId(parentId) : null;
    return (this.contentTree.get(key) ?? []).map((n) => this.decorateWorkflow({ ...n.item }));
  }

  async getContentItems(itemIds: string[]): Promise<ContentItem[]> {
    await delay(this.latencyMs);
    const items: ContentItem[] = [];
    for (const id of itemIds) {
      const node = this.findContentNode(id);
      if (node) items.push(this.decorateWorkflow({ ...node.item }));
    }
    return items;
  }

  async assignWorkflow(items: ContentItem[], workflowId: string): Promise<AssignmentResult[]> {
    await delay(this.latencyMs);
    if (items.length === 0) return [];
    if (items.length > MAX_ASSIGN_SELECTION) {
      throw new Error(
        `Refusing to assign a workflow to ${items.length} items — the limit is ${MAX_ASSIGN_SELECTION} per operation.`,
      );
    }
    const wf = this.workflows.find((w) => w.workflowId === normalizeId(workflowId));
    const initial = wf?.states.find((s) => s.initial);
    if (!wf || !initial) {
      throw new Error(
        'The workflow or its initial state could not be verified, so nothing was assigned.',
      );
    }
    const results: AssignmentResult[] = [];
    for (const item of items) {
      const node = this.findContentNode(item.itemId);
      if (!node) {
        results.push({
          itemId: normalizeId(item.itemId),
          name: item.name,
          path: item.path,
          successful: false,
          error: 'The item no longer exists.',
        });
        continue;
      }
      node.item.workflow = { workflowId: wf.workflowId, displayName: wf.displayName };
      node.item.workflowState = { stateId: initial.stateId, displayName: initial.displayName };
      // Surface the item in the workflow's initial-state queue.
      const key = queueKey(wf.workflowId, initial.stateId);
      const queue = this.queueItems.get(key) ?? [];
      if (!queue.some((q) => q.item.itemId === node.item.itemId)) {
        const nextStateByCommand: Record<string, string> = {};
        for (const t of this.transitions.get(wf.workflowId) ?? []) {
          if (t.fromStateId === initial.stateId && t.toStateId) {
            nextStateByCommand[t.commandId] = t.toStateId;
          }
        }
        queue.push({
          item: {
            itemId: node.item.itemId,
            name: node.item.name,
            path: node.item.path,
            language: node.item.language,
            version: node.item.version,
            updatedAt: new Date().toISOString(),
            updatedBy: 'sitecore\\demo.editor',
          },
          nextStateByCommand,
        });
        this.queueItems.set(key, queue);
      }
      results.push({
        itemId: node.item.itemId,
        name: node.item.name,
        path: node.item.path,
        successful: true,
        error: null,
      });
    }
    return results;
  }

  /* ---------------- Page builder companion (demo) ---------------- */

  private pageListeners = new Set<(page: PageContextInfo | null) => void>();
  private updateListeners = new Set<() => void>();
  private demoPageIndex = 0;
  private destroyed = false;

  /**
   * Demo pages simulate what the Page builder would report. They point at
   * real demo fixtures (queue items and content-tree pages) so the panel
   * exercises the same read/guard/write paths as live mode.
   */
  listDemoPages(): PageContextInfo[] {
    const pages: PageContextInfo[] = [];
    for (const name of ['Privacy Update', 'Spring Campaign Landing']) {
      for (const items of this.queueItems.values()) {
        const found = items.find((i) => i.item.name === name);
        if (found) {
          pages.push({
            itemId: found.item.itemId,
            name: found.item.name,
            path: found.item.path,
            language: found.item.language,
            version: found.item.version,
            route: null,
          });
          break;
        }
      }
    }
    const home = this.findContentNode(CT_HOME);
    if (home) {
      pages.push({
        itemId: home.item.itemId,
        name: home.item.name,
        path: home.item.path,
        language: home.item.language,
        version: home.item.version,
        route: '/',
      });
    }
    return pages;
  }

  /** Demo-only: simulate the editor navigating to another page. */
  navigateDemoPage(index: number): void {
    const pages = this.listDemoPages();
    if (pages.length === 0) return;
    this.demoPageIndex = ((index % pages.length) + pages.length) % pages.length;
    const page = pages[this.demoPageIndex] ?? null;
    for (const listener of this.pageListeners) listener(page);
  }

  /** Demo/test-only: fire a content-updated event. */
  emitContentUpdate(): void {
    for (const listener of this.updateListeners) listener();
  }

  get currentDemoPageIndex(): number {
    return this.demoPageIndex;
  }

  subscribePageContext(listener: (page: PageContextInfo | null) => void): () => void {
    this.pageListeners.add(listener);
    // Emit the current demo page asynchronously, mirroring the live host's
    // handshake latency.
    void delay(this.latencyMs).then(() => {
      if (this.destroyed || !this.pageListeners.has(listener)) return;
      listener(this.listDemoPages()[this.demoPageIndex] ?? null);
    });
    return () => {
      this.pageListeners.delete(listener);
    };
  }

  subscribeContentUpdates(listener: () => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  async getItemWorkflowStatus(
    itemId: string,
    _language: string,
  ): Promise<ItemWorkflowStatus | null> {
    await delay(this.latencyMs);
    const id = normalizeId(itemId);
    // Queue fixtures are authoritative for items sitting in a workflow.
    for (const [key, items] of this.queueItems) {
      const entry = items.find((i) => i.item.itemId === id);
      if (!entry) continue;
      const [workflowId, stateId] = splitQueueKey(key);
      const wf = this.workflows.find((w) => w.workflowId === workflowId);
      const state = wf?.states.find((s) => s.stateId === stateId);
      if (!wf || !state) return null;
      return {
        itemId: id,
        name: entry.item.name,
        path: entry.item.path,
        language: entry.item.language,
        version: entry.item.version,
        updatedAt: entry.item.updatedAt,
        workflow: { workflowId: wf.workflowId, displayName: wf.displayName },
        state: { stateId: state.stateId, displayName: state.displayName, final: state.final },
      };
    }
    // Content-tree items may carry workflow metadata without a queue entry
    // (e.g. final states in the demo tree).
    const node = this.findContentNode(id);
    if (!node) return null;
    const decorated = this.decorateWorkflow({ ...node.item });
    const wf = decorated.workflow
      ? this.workflows.find((w) => w.workflowId === decorated.workflow!.workflowId)
      : undefined;
    const state = wf?.states.find((s) => s.stateId === decorated.workflowState?.stateId);
    return {
      itemId: id,
      name: decorated.name,
      path: decorated.path,
      language: decorated.language,
      version: decorated.version,
      updatedAt: null,
      workflow: decorated.workflow,
      state: state
        ? { stateId: state.stateId, displayName: state.displayName, final: state.final }
        : decorated.workflowState
          ? { ...decorated.workflowState, final: false }
          : null,
    };
  }

  /* ---------------- Brand Review (deterministic demo samples) ---------------- */

  async getBrandReviewSupport(): Promise<BrandReviewSupport> {
    await delay(this.latencyMs);
    return { available: true, brandKitId: DEMO_BRAND_KIT_ID, message: null };
  }

  async getItemReviewContent(itemId: string, language: string): Promise<ReviewContent | null> {
    await delay(this.latencyMs);
    const id = normalizeId(itemId);
    let name: string | null = null;
    let version: number | null = null;
    let updatedAt: string | null = null;
    for (const items of this.queueItems.values()) {
      const entry = items.find((i) => i.item.itemId === id);
      if (entry) {
        name = entry.item.name;
        version = entry.item.version;
        updatedAt = entry.item.updatedAt;
        break;
      }
    }
    if (!name) {
      const node = this.findContentNode(id);
      if (!node) return null;
      name = node.item.name;
      version = node.item.version;
    }
    // Deterministic sample copy — clearly not live Sitecore field data.
    const entries = limitReviewEntries([
      { source: 'field', label: 'Title', text: name },
      {
        source: 'field',
        label: 'Body',
        text: `Demo sample copy for "${name}". This text stands in for the item's real fields while the app runs in demo mode.`,
      },
      {
        source: 'datasource',
        label: `${name} Hero · Headline`,
        text: `Discover ${name} — a demo headline used for sample AI analysis.`,
      },
    ]);
    return {
      itemId: id,
      language,
      version,
      updatedAt,
      entries: entries.entries,
      truncated: entries.truncated,
    };
  }

  async generateBrandReview(
    _brandKitId: string,
    content: ReviewContent,
  ): Promise<BrandReviewSectionResult[]> {
    await delay(this.latencyMs);
    // Deterministic: same content always yields the same sample scores.
    const fp = contentFingerprint(content);
    let seed = 0;
    for (let i = 0; i < fp.length; i++) seed = (seed * 31 + fp.charCodeAt(i)) | 0;
    const score = (offset: number) => 2 + Math.abs(seed + offset) % 4; // 2..5
    const sections: Array<{ id: string; focus: string }> = [
      { id: 'voice-and-tone', focus: 'voice and tone' },
      { id: 'terminology', focus: 'terminology' },
      { id: 'messaging', focus: 'messaging' },
    ];
    return sections.map((section, i) => {
      const s = score(i * 7);
      return {
        sectionId: section.id,
        score: s,
        reason: `Demo sample analysis: the reviewed copy scores ${s}/5 for ${section.focus} against the demo brand kit. This is not a live AI review.`,
        suggestion:
          s >= 4
            ? `Demo suggestion: keep the current ${section.focus} approach.`
            : `Demo suggestion: tighten the ${section.focus} to match the demo brand guidelines.`,
        fields: content.entries.slice(0, 2).map((entry, j) => ({
          fieldId: entry.label,
          score: score(i * 7 + j + 3),
          reason: `Demo sample note for "${entry.label}".`,
          suggestion: `Demo suggestion for "${entry.label}".`,
        })),
      };
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.pageListeners.clear();
    this.updateListeners.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Demo workflow fixtures                                              */
/* ------------------------------------------------------------------ */

interface DemoQueueItem {
  item: QueueItem;
  /** commandId → target stateId used by executeCommand in demo mode. */
  nextStateByCommand: Record<string, string>;
}

function queueKey(workflowId: string, stateId: string): string {
  return `${normalizeId(workflowId)}::${normalizeId(stateId)}`;
}

function splitQueueKey(key: string): [string, string] {
  const [wf, st] = key.split('::');
  return [wf!, st!];
}

let demoIdCounter = 0;
function randomDemoId(): string {
  demoIdCounter += 1;
  const suffix = demoIdCounter.toString(16).toUpperCase().padStart(12, '0');
  return `{DE300000-0000-4000-8000-${suffix}}`;
}

const WF_SAMPLE = '{A5BC37E7-ED96-4C1E-8590-A26E64DB55EA}';
const ST_DRAFT = '{190B1C84-F1BE-47ED-AA41-F42193D9C8FC}';
const ST_AWAITING = '{46DA5376-10DC-4B66-B464-AFDAA29DE84F}';
const ST_APPROVED = '{FCA998C5-0CC3-4F91-94D8-0A4E6CAECE88}';
const CMD_SUBMIT = '{CF6A557D-0B86-4432-BF47-302A18238E74}';
const CMD_APPROVE = '{F744CC9C-4BB1-4B38-8D5C-1E9CE7F45D2D}';
const CMD_REJECT = '{E44F2D64-1EED-42FF-A7DA-C07B834096AC}';
const WF_LANDING = '{B1000000-0000-4000-8000-000000000001}';
const ST_LANDING_DRAFT = '{B1000000-0000-4000-8000-000000000002}';
const ST_LEGAL = '{B1000000-0000-4000-8000-000000000003}';
const ST_PUBLISHED = '{B1000000-0000-4000-8000-000000000004}';
const CMD_PUBLISH = '{B1000000-0000-4000-8000-000000000005}';
const CMD_LEGAL_REJECT = '{B1000000-0000-4000-8000-000000000006}';

function demoWorkflows(): WorkflowInfo[] {
  return [
    {
      workflowId: WF_SAMPLE,
      displayName: 'Sample Workflow',
      states: [
        { stateId: ST_DRAFT, displayName: 'Draft', final: false, initial: true },
        { stateId: ST_AWAITING, displayName: 'Awaiting Approval', final: false, initial: false },
        { stateId: ST_APPROVED, displayName: 'Approved', final: true, initial: false },
      ],
    },
    {
      workflowId: WF_LANDING,
      displayName: 'Landing Page Workflow',
      states: [
        { stateId: ST_LANDING_DRAFT, displayName: 'Draft', final: false, initial: true },
        { stateId: ST_LEGAL, displayName: 'Legal Review', final: false, initial: false },
        { stateId: ST_PUBLISHED, displayName: 'Published', final: true, initial: false },
      ],
    },
  ];
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function demoQueueItem(
  name: string,
  path: string,
  updatedHoursAgo: number,
  updatedBy: string,
  nextStateByCommand: Record<string, string>,
  language = 'en',
): DemoQueueItem {
  return {
    item: {
      itemId: randomDemoId(),
      name,
      path,
      language,
      version: 1,
      updatedAt: hoursAgo(updatedHoursAgo),
      updatedBy,
    },
    nextStateByCommand,
  };
}

function demoQueueItems(): Map<string, DemoQueueItem[]> {
  const map = new Map<string, DemoQueueItem[]>();
  map.set(queueKey(WF_SAMPLE, ST_DRAFT), [
    demoQueueItem(
      'Hero — Ready To Build',
      '/sitecore/content/brands/new-brand/Home/Data/Hero Build',
      6,
      'sitecore\\maria.content',
      { [CMD_SUBMIT]: ST_AWAITING },
    ),
    demoQueueItem(
      'Services Banner',
      '/sitecore/content/brands/new-brand/Home/Data/Services',
      70,
      'sitecore\\jon.writer',
      { [CMD_SUBMIT]: ST_AWAITING },
    ),
  ]);
  map.set(queueKey(WF_SAMPLE, ST_AWAITING), [
    demoQueueItem(
      'Ready Stories Rail',
      '/sitecore/content/brands/new-brand/Home/Data/Stories',
      200,
      'sitecore\\maria.content',
      { [CMD_APPROVE]: ST_APPROVED, [CMD_REJECT]: ST_DRAFT },
    ),
  ]);
  map.set(queueKey(WF_SAMPLE, ST_APPROVED), []);
  // Landing draft deliberately has no commands: it is visible work, but is
  // truthfully non-actionable until Sitecore exposes a transition.
  map.set(queueKey(WF_LANDING, ST_LANDING_DRAFT), [
    demoQueueItem(
      'Spring Campaign Landing',
      '/sitecore/content/brands/new-brand/Spring',
      12,
      'sitecore\\anna.editor',
      {},
      'da',
    ),
  ]);
  map.set(queueKey(WF_LANDING, ST_LEGAL), [
    demoQueueItem('Privacy Update', '/sitecore/content/brands/new-brand/Privacy', 216, 'sitecore\\legal.one', { [CMD_PUBLISH]: ST_PUBLISHED, [CMD_LEGAL_REJECT]: ST_LANDING_DRAFT }),
    demoQueueItem('Partner Landing', '/sitecore/content/brands/new-brand/Partners', 76, 'sitecore\\anna.editor', { [CMD_PUBLISH]: ST_PUBLISHED, [CMD_LEGAL_REJECT]: ST_LANDING_DRAFT }, 'da'),
    demoQueueItem('Summer Campaign', '/sitecore/content/brands/new-brand/Summer', 8, 'sitecore\\jon.writer', { [CMD_PUBLISH]: ST_PUBLISHED, [CMD_LEGAL_REJECT]: ST_LANDING_DRAFT }),
    demoQueueItem('Autumn Campaign', '/sitecore/content/brands/new-brand/Autumn', 4, 'sitecore\\jon.writer', { [CMD_PUBLISH]: ST_PUBLISHED, [CMD_LEGAL_REJECT]: ST_LANDING_DRAFT }),
  ]);
  // A final-state fixture proves aggregation excludes completed work.
  map.set(queueKey(WF_LANDING, ST_PUBLISHED), [
    demoQueueItem('Published Homepage', '/sitecore/content/brands/new-brand/Published', 300, 'sitecore\\publisher', {}),
  ]);
  return map;
}

function demoCommands(): Map<string, WorkflowCommandInfo[]> {
  const map = new Map<string, WorkflowCommandInfo[]>();
  map.set(queueKey(WF_SAMPLE, ST_DRAFT), [
    { commandId: CMD_SUBMIT, displayName: 'Submit', suppressComments: false },
  ]);
  map.set(queueKey(WF_SAMPLE, ST_AWAITING), [
    { commandId: CMD_APPROVE, displayName: 'Approve', suppressComments: false },
    { commandId: CMD_REJECT, displayName: 'Reject', suppressComments: false },
  ]);
  map.set(queueKey(WF_SAMPLE, ST_APPROVED), []);
  map.set(queueKey(WF_LANDING, ST_LANDING_DRAFT), []);
  map.set(queueKey(WF_LANDING, ST_LEGAL), [
    { commandId: CMD_PUBLISH, displayName: 'Publish', suppressComments: false },
    { commandId: CMD_LEGAL_REJECT, displayName: 'Reject', suppressComments: false },
  ]);
  map.set(queueKey(WF_LANDING, ST_PUBLISHED), []);
  return map;
}

function demoHistory(): Map<string, WorkflowHistoryEvent[]> {
  // History accrues as demo commands run; queues start with none recorded.
  return new Map();
}

/* ------------------------------------------------------------------ */
/* Demo content tree (pages + component-surrounding content)           */
/* ------------------------------------------------------------------ */

interface DemoContentNode {
  item: ContentItem;
  parentId: string | null;
}

function demoContentItem(args: {
  itemId: string;
  name: string;
  path: string;
  templateName: string;
  hasChildren: boolean;
  workflow?: { workflowId: string; displayName: string } | null;
  workflowState?: { stateId: string; displayName: string } | null;
}): ContentItem {
  return {
    itemId: args.itemId,
    name: args.name,
    path: args.path,
    templateName: args.templateName,
    kind: classifyTemplate(args.templateName),
    hasChildren: args.hasChildren,
    language: 'en',
    version: 1,
    workflow: args.workflow ?? null,
    workflowState: args.workflowState ?? null,
  };
}

const CT_HOME = '{DEC01000-0000-4000-8000-000000000001}';
const CT_DATA = '{DEC01000-0000-4000-8000-000000000002}';
const CT_ABOUT = '{DEC01000-0000-4000-8000-000000000003}';
const CT_PRODUCTS = '{DEC01000-0000-4000-8000-000000000004}';
const CT_HERO = '{DEC01000-0000-4000-8000-000000000005}';
const CT_SERVICES = '{DEC01000-0000-4000-8000-000000000006}';
const CT_STORIES = '{DEC01000-0000-4000-8000-000000000007}';
const CT_CATALOG = '{DEC01000-0000-4000-8000-000000000008}';
const CT_PROD_TRUSSES = '{DEC01000-0000-4000-8000-000000000009}';
const CT_PROD_PANELS = '{DEC01000-0000-4000-8000-00000000000A}';

function demoContentTree(): Map<string | null, DemoContentNode[]> {
  const base = '/sitecore/content/brands/new-brand';
  const sample = { workflowId: WF_SAMPLE, displayName: 'Sample Workflow' };
  const draft = { stateId: ST_DRAFT, displayName: 'Draft' };
  const awaiting = { stateId: ST_AWAITING, displayName: 'Awaiting Approval' };
  const approved = { stateId: ST_APPROVED, displayName: 'Approved' };
  const map = new Map<string | null, DemoContentNode[]>();
  map.set(null, [
    {
      parentId: null,
      item: demoContentItem({
        itemId: CT_HOME,
        name: 'Home',
        path: `${base}/Home`,
        templateName: 'Landing Page',
        hasChildren: true,
        workflow: sample,
        workflowState: approved,
      }),
    },
    {
      parentId: null,
      item: demoContentItem({
        itemId: CT_ABOUT,
        name: 'About',
        path: `${base}/About`,
        templateName: 'Content Page',
        hasChildren: false,
      }),
    },
    {
      parentId: null,
      item: demoContentItem({
        itemId: CT_PRODUCTS,
        name: 'Products',
        path: `${base}/Products`,
        templateName: 'Content Page',
        hasChildren: true,
      }),
    },
  ]);
  map.set(CT_HOME, [
    {
      parentId: CT_HOME,
      item: demoContentItem({
        itemId: CT_DATA,
        name: 'Data',
        path: `${base}/Home/Data`,
        templateName: 'Data Folder',
        hasChildren: true,
      }),
    },
  ]);
  map.set(CT_DATA, [
    {
      parentId: CT_DATA,
      item: demoContentItem({
        itemId: CT_HERO,
        name: 'Hero Build',
        path: `${base}/Home/Data/Hero Build`,
        templateName: 'Hero Section',
        hasChildren: false,
        workflow: sample,
        workflowState: draft,
      }),
    },
    {
      parentId: CT_DATA,
      item: demoContentItem({
        itemId: CT_SERVICES,
        name: 'Services',
        path: `${base}/Home/Data/Services`,
        templateName: 'Promo Banner',
        hasChildren: false,
        workflow: sample,
        workflowState: draft,
      }),
    },
    {
      parentId: CT_DATA,
      item: demoContentItem({
        itemId: CT_STORIES,
        name: 'Stories',
        path: `${base}/Home/Data/Stories`,
        templateName: 'Stories Rail',
        hasChildren: false,
        workflow: sample,
        workflowState: awaiting,
      }),
    },
    {
      parentId: CT_DATA,
      item: demoContentItem({
        itemId: CT_CATALOG,
        name: 'Catalog',
        path: `${base}/Home/Data/Catalog`,
        templateName: 'Catalog Section',
        hasChildren: false,
      }),
    },
  ]);
  map.set(CT_PRODUCTS, [
    {
      parentId: CT_PRODUCTS,
      item: demoContentItem({
        itemId: CT_PROD_TRUSSES,
        name: 'Trusses',
        path: `${base}/Products/Trusses`,
        templateName: 'Product Page',
        hasChildren: false,
      }),
    },
    {
      parentId: CT_PRODUCTS,
      item: demoContentItem({
        itemId: CT_PROD_PANELS,
        name: 'Wall Panels',
        path: `${base}/Products/Wall Panels`,
        templateName: 'Product Page',
        hasChildren: false,
      }),
    },
  ]);
  return map;
}

function demoTransitions(): Map<string, WorkflowTransitionInfo[]> {
  const map = new Map<string, WorkflowTransitionInfo[]>();
  map.set(WF_SAMPLE, [
    { commandId: CMD_SUBMIT, displayName: 'Submit', fromStateId: ST_DRAFT, toStateId: ST_AWAITING },
    { commandId: CMD_APPROVE, displayName: 'Approve', fromStateId: ST_AWAITING, toStateId: ST_APPROVED },
    { commandId: CMD_REJECT, displayName: 'Reject', fromStateId: ST_AWAITING, toStateId: ST_DRAFT },
  ]);
  map.set(WF_LANDING, [
    { commandId: CMD_PUBLISH, displayName: 'Publish', fromStateId: ST_LEGAL, toStateId: ST_PUBLISHED },
    { commandId: CMD_LEGAL_REJECT, displayName: 'Reject', fromStateId: ST_LEGAL, toStateId: ST_LANDING_DRAFT },
  ]);
  return map;
}
