import {
  SECTION_DEFINITIONS,
  type SectionDefinition,
  type SectionValues,
} from '@/lib/home-content';
import type { EditorUser, MarketplaceHost, SiteSummary } from './host';
import {
  normalizeId,
  validateDraftWorkflow,
  type CommandResult,
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

/**
 * Demo host for local preview. The Replit preview does not run inside
 * SitecoreAI, so there is no Marketplace handshake available; this host
 * serves a faithful in-memory copy of the real New Brand homepage content
 * and applies saves to that copy only. The UI shows a persistent "Demo
 * mode" indicator whenever this host is active.
 */

const SEED: Record<string, SectionValues> = {
  'hero-build': {
    eyebrow: 'READY TO BUILD',
    headlineLine1: 'LUMBER ON THE',
    headlineLine2: 'GROUND',
    description: 'Your crew frames it. Lowest cost per foot.',
  },
  'hero-assemble': {
    eyebrow: 'READY TO ASSEMBLE',
    headlineLine1: 'CUT TO YOUR',
    headlineLine2: 'PLANS',
    description: 'Precut packages arrive labeled in build order.',
  },
  'hero-raise': {
    eyebrow: 'READY TO RAISE',
    headlineLine1: 'BUILT BEFORE',
    headlineLine2: 'IT SHIPS',
    description: 'Trusses and panels come off our line, not your lot.',
  },
  'search-dock': {
    placeholderText: 'SEARCH THE FULL CATALOG — TRUSSES, WINDOWS, TURN-KEY FRAMING...',
    emptyMessage: 'NO MATCHES — TRY "TRUSSES", "WINDOWS", OR "FRAMING"',
    locationName: 'ROCKWALL, TX',
    locationMeta: '— 22 MI',
    locationHours: 'OPEN UNTIL 5:00 PM',
  },
  capabilities: {
    eyebrow: 'WHAT ARRIVES BUILT',
    title: 'READY MEANS BUILT BEFORE IT SHIPS',
    description:
      'Hours move off your site, into our plant. Your local yard decides what arrives built.',
    ctaLabel: 'SEE HOW READY YOURS CAN ARRIVE',
    ctaHref: '#ready-plan',
    bandEyebrow: 'INSIDE THE PLANT',
    bandTitle: "THE HOURS YOU DON'T SPEND FRAMING START HERE.",
    bandDescription:
      'Trusses, panels, and precut packages come off this line, built to your plans.',
  },
  catalog: {
    eyebrow: 'THE FULL CATALOG',
    title: 'EVERYTHING ELSE? ALSO READY.',
    description:
      'One subdivision or one remodel. Foundation to finish, you pull it from one catalog.',
    ctaLabel: 'FIND YOUR LOCATION',
    ctaHref: '#catalog-search',
    supportText: 'SUPPORTED BY 565+ LOCATIONS NATIONWIDE',
  },
  greener: {
    eyebrow: 'A GREENER WAY TO BUILD',
    title: 'PLANT PRECISION IS WHY LESS FOREST ENDS UP IN YOUR DUMPSTER.',
    description:
      "Optimized cutting in the plant means less waste in your dumpster — and the trees you don't burn through stay standing.",
    linkLabel: 'SEE HOW MUCH YOURS COULD SAVE →',
    linkHref: '#ready-plan',
  },
  quote: {
    eyebrow: 'YOUR QUOTE',
    title: 'SO — HOW READY SHOULD YOURS ARRIVE?',
    description:
      'Upload your plans. We take off the materials, quote the package, and show you what your plant can build before it ships.',
    ctaLabel: 'TELL US HOW READY',
    ctaHref: '#catalog-search',
    noteLine1: 'PLANS IN — QUOTE OUT',
    noteLine2: 'NO SITE VISIT REQUIRED',
  },
  'know-how': {
    eyebrow: 'WHY IT HOLDS UP',
    title: "READY ISN'T LUCK. IT'S ENGINEERED.",
    sideText: "We don't just ship material. We engineer your path from slab to roof.",
    ctaLabel: 'SEE THE BUILD SCIENCE',
    ctaHref: '#inside-the-plant',
  },
  services: {
    heading: 'WANT IT EVEN READIER?',
    note: 'Every service starts the same way — with your plans.',
    linkLabel: 'START WITH A READY QUOTE →',
    linkHref: '#ready-plan',
  },
};

const LATENCY_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockMarketplaceHost implements MarketplaceHost {
  readonly mode = 'demo' as const;
  private store: Record<string, SectionValues>;
  private latencyMs: number;

  constructor(options?: { latencyMs?: number }) {
    this.latencyMs = options?.latencyMs ?? LATENCY_MS;
    // Deep-copy the seed so saves never mutate module state across instances.
    this.store = Object.fromEntries(
      SECTION_DEFINITIONS.map((s) => [s.id, { ...(SEED[s.id] ?? {}) }]),
    );
  }

  async getUser(): Promise<EditorUser> {
    await delay(this.latencyMs);
    return { name: 'Demo Editor', email: 'demo.editor@example.com' };
  }

  async getSite(): Promise<SiteSummary> {
    await delay(this.latencyMs);
    return {
      siteName: 'New Brand',
      homePath: '/sitecore/content/brands/new-brand/Home',
      environment: 'Demo (no Sitecore connection)',
    };
  }

  async loadSection(section: SectionDefinition): Promise<SectionValues> {
    await delay(this.latencyMs);
    const values = this.store[section.id];
    if (!values) {
      throw new Error(`Unknown section: ${section.id}`);
    }
    return { ...values };
  }

  async saveSection(section: SectionDefinition, changed: SectionValues): Promise<void> {
    await delay(this.latencyMs);
    const values = this.store[section.id];
    if (!values) {
      throw new Error(`Unknown section: ${section.id}`);
    }
    const allowed = new Set(section.fields.map((f) => f.key));
    for (const key of Object.keys(changed)) {
      if (!allowed.has(key)) {
        throw new Error(`Field "${key}" is not editable on section "${section.id}".`);
      }
    }
    Object.assign(values, changed);
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

  async getQueue(workflowId: string, stateId: string): Promise<QueuePage> {
    await delay(this.latencyMs);
    const items = this.queueItems.get(queueKey(workflowId, stateId)) ?? [];
    return {
      items: items.map((i) => ({ ...i.item })),
      hasNextPage: false,
      endCursor: null,
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

  destroy(): void {
    // Nothing to release.
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
): DemoQueueItem {
  return {
    item: {
      itemId: randomDemoId(),
      name,
      path,
      language: 'en',
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
  return map;
}

function demoHistory(): Map<string, WorkflowHistoryEvent[]> {
  // History accrues as demo commands run; queues start with none recorded.
  return new Map();
}

function demoTransitions(): Map<string, WorkflowTransitionInfo[]> {
  const map = new Map<string, WorkflowTransitionInfo[]>();
  map.set(WF_SAMPLE, [
    { commandId: CMD_SUBMIT, displayName: 'Submit', fromStateId: ST_DRAFT, toStateId: ST_AWAITING },
    { commandId: CMD_APPROVE, displayName: 'Approve', fromStateId: ST_AWAITING, toStateId: ST_APPROVED },
    { commandId: CMD_REJECT, displayName: 'Reject', fromStateId: ST_AWAITING, toStateId: ST_DRAFT },
  ]);
  return map;
}
