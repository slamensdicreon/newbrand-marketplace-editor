import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import { AI } from '@sitecore-marketplace-sdk/ai';
import {
  contentFingerprint,
  extractPlainText,
  isReviewableFieldName,
  limitReviewEntries,
  type BrandReviewSectionResult,
  type BrandReviewSupport,
  type ReviewContent,
  type ReviewContentEntry,
} from '@/lib/workflow/brand-review';
import {
  classifyTemplate,
  normalizeId,
  parseSitecoreDate,
  validateDraftWorkflow,
  MAX_ASSIGN_SELECTION,
  type AssignmentResult,
  type CommandResult,
  type ContentItem,
  type DraftWorkflowSpec,
  type ExecuteCommandArgs,
  type QueuePage,
  type StateCounts,
  type WorkflowCommandInfo,
  type WorkflowGraph,
  type WorkflowHistoryEvent,
  type WorkflowInfo,
} from '@/lib/workflow/types';
import {
  HostUnavailableError,
  detectEmbeddingOrigin,
  isEmbedded,
  resolveAllowedHostOrigin,
  type EditorUser,
  type ItemWorkflowStatus,
  type MarketplaceHost,
  type PageContextInfo,
} from './host';

const HANDSHAKE_TIMEOUT_MS = 8000;
const LANGUAGE = 'en';

/** Render only the origin (never path/query) for error messages. */
function safeOriginLabel(originOrUrl: string): string {
  try {
    return new URL(originOrUrl).origin;
  } catch {
    return 'unknown origin';
  }
}

/** Distinguish a handshake timeout from other SDK init failures. */
function handshakeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(raw)) {
    return 'SitecoreAI did not answer the connection handshake in time. Reload the app inside SitecoreAI and try again.';
  }
  if (/origin/i.test(raw)) {
    return 'SitecoreAI responded from an origin that is not an approved Sitecore host, so the connection was refused.';
  }
  return 'The connection handshake with SitecoreAI failed. Reload the app inside SitecoreAI and try again.';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract this app's page identity from a Marketplace `pages.context`
 * payload. Returns null when no usable page identity is present.
 */
export function pageContextFrom(data: unknown): PageContextInfo | null {
  const ctx = data as {
    pageInfo?: {
      id?: string;
      name?: string;
      displayName?: string;
      path?: string;
      language?: string;
      version?: number;
      route?: string;
    } | null;
    siteInfo?: { language?: string } | null;
  } | null;
  const page = ctx?.pageInfo;
  if (!page?.id) return null;
  return {
    itemId: normalizeId(page.id),
    name: page.displayName || page.name || 'Untitled page',
    path: page.path ?? '',
    language: page.language || ctx?.siteInfo?.language || LANGUAGE,
    version: typeof page.version === 'number' ? page.version : null,
    route: page.route ?? null,
  };
}

interface GraphQLEnvelope {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
}

interface MarketplaceAppContext {
  resourceAccess?: Array<{
    resourceId?: string;
    tenantDisplayName?: string;
    context?: { live?: string; preview?: string };
  }>;
  /** Older SDK hosts may still expose the deprecated resources property. */
  resources?: Array<{
    resourceId?: string;
    tenantDisplayName?: string;
    context?: { live?: string; preview?: string };
  }>;
}

/**
 * Live host: talks to SitecoreAI through the official Marketplace client
 * SDK. All Sitecore API traffic is mediated by the host application — this
 * app never sees or stores credentials or tokens. Sitecore operations go
 * through the host's Authoring GraphQL bridge (`xmc.authoring.graphql`).
 */
export class SdkMarketplaceHost implements MarketplaceHost {
  readonly mode = 'live' as const;
  private client: ClientSDK;
  private sitecoreContextId: string;

  private constructor(client: ClientSDK, sitecoreContextId: string) {
    this.client = client;
    this.sitecoreContextId = sitecoreContextId;
  }

  /**
   * Perform the Marketplace handshake.
   *
   * Trust model (fail-closed):
   * - Not embedded → fail immediately, nothing is messaged.
   * - Embedding origin not detectable (browser strips referrer and lacks
   *   ancestorOrigins) → fail immediately, nothing is messaged. We never
   *   hand origin discovery to the SDK because its built-in validation does
   *   not enforce HTTPS.
   * - Embedding origin detectable but NOT a trusted Sitecore HTTPS domain →
   *   fail immediately, nothing is messaged.
   * - Embedding origin detectable and trusted → handshake pinned to that
   *   exact origin.
   */
  static async connect(): Promise<SdkMarketplaceHost> {
    if (!isEmbedded(window)) {
      throw new HostUnavailableError(
        'Not running inside SitecoreAI — no Marketplace host is present.',
      );
    }
    const detected = detectEmbeddingOrigin();
    if (!detected) {
      throw new HostUnavailableError(
        'The browser did not reveal the embedding page, so the Sitecore host could not be verified. Open the app inside SitecoreAI using a Chromium-based browser or Safari and try again.',
      );
    }
    const origin = resolveAllowedHostOrigin(detected);
    if (!origin) {
      throw new HostUnavailableError(
        `The embedding page (${safeOriginLabel(detected)}) is not an approved Sitecore host.`,
      );
    }
    let client: ClientSDK;
    try {
      client = await ClientSDK.init({
        origin,
        target: window.parent,
        timeout: HANDSHAKE_TIMEOUT_MS,
        modules: [XMC, AI],
      });
    } catch (error) {
      throw new HostUnavailableError(handshakeFailureMessage(error));
    }

    const { data } = await client.query('application.context');
    const appContext = data as MarketplaceAppContext | undefined;
    const resources = appContext?.resourceAccess ?? appContext?.resources ?? [];
    const sitecoreContextId = resources.find((resource) => resource.context?.live)?.context?.live;
    if (!sitecoreContextId) {
      client.destroy();
      throw new HostUnavailableError(
        'This Marketplace app is connected, but it has no SitecoreAI API resource access. In the Marketplace app settings, grant this app SitecoreAI APIs access to the XM Cloud environment that contains New Brand, then reopen the app.',
      );
    }

    return new SdkMarketplaceHost(client, sitecoreContextId);
  }

  async getUser(): Promise<EditorUser> {
    const { data } = await this.client.query('host.user');
    const user = data as { name?: string; email?: string } | undefined;
    return { name: user?.name ?? 'Sitecore editor', email: user?.email };
  }

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.client.mutate('xmc.authoring.graphql', {
      params: {
        query: { sitecoreContextId: this.sitecoreContextId },
        body: { query, variables },
      },
    });
    const envelope = (result as { data?: GraphQLEnvelope }).data ?? (result as GraphQLEnvelope);
    if (envelope.errors?.length) {
      throw new Error(
        envelope.errors.map((e) => e.message ?? 'Unknown GraphQL error').join('; '),
      );
    }
    if (!envelope.data) {
      throw new Error('Empty response from the Sitecore Authoring API.');
    }
    return envelope.data;
  }

  /* ---------------- Workflow operations ---------------- */

  async listWorkflows(): Promise<WorkflowInfo[]> {
    const data = await this.graphql(
      `query ListWorkflows {
        workflows {
          nodes {
            workflowId
            displayName
            initialState { stateId }
            states { nodes { stateId displayName final } }
          }
        }
      }`,
      {},
    );
    const nodes =
      (data['workflows'] as {
        nodes?: Array<{
          workflowId: string;
          displayName: string;
          initialState?: { stateId: string } | null;
          states?: { nodes?: Array<{ stateId: string; displayName: string; final: boolean | null }> };
        }>;
      })?.nodes ?? [];
    return nodes.map((wf) => {
      const initialId = wf.initialState ? normalizeId(wf.initialState.stateId) : null;
      return {
        workflowId: normalizeId(wf.workflowId),
        displayName: wf.displayName,
        states: (wf.states?.nodes ?? []).map((s) => ({
          stateId: normalizeId(s.stateId),
          displayName: s.displayName,
          final: s.final === true,
          initial: normalizeId(s.stateId) === initialId,
        })),
      };
    });
  }

  async getStateCounts(workflowId: string, stateIds: string[]): Promise<StateCounts> {
    if (stateIds.length === 0) return {};
    // One aliased query keeps this a single host round-trip.
    const aliases = stateIds.map((_, i) => `c${i}: itemsCount(stateId: $s${i})`).join('\n');
    const varDefs = stateIds.map((_, i) => `$s${i}: String!`).join(', ');
    const variables: Record<string, unknown> = { workflowId };
    stateIds.forEach((id, i) => {
      variables[`s${i}`] = id;
    });
    const data = await this.graphql(
      `query StateCounts($workflowId: String!, ${varDefs}) {
        workflow(where: { workflowId: $workflowId }) { ${aliases} }
      }`,
      variables,
    );
    const wf = data['workflow'] as Record<string, number> | null | undefined;
    const counts: StateCounts = {};
    stateIds.forEach((id, i) => {
      counts[normalizeId(id)] = typeof wf?.[`c${i}`] === 'number' ? wf[`c${i}`] : 0;
    });
    return counts;
  }

  async getQueue(workflowId: string, stateId: string, after?: string | null): Promise<QueuePage> {
    const data = await this.graphql(
      `query WorkflowQueue($workflowId: String!, $stateId: String!, $after: String) {
        workflow(where: { workflowId: $workflowId }) {
          items(stateId: $stateId, first: 25, after: $after) {
            nodes {
              itemId
              name
              path
              version
              language { name }
              updated: field(name: "__Updated") { value }
              updatedBy: field(name: "__Updated by") { value }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { workflowId, stateId, after: after ?? null },
    );
    const items =
      (data['workflow'] as {
        items?: {
          nodes?: Array<{
            itemId: string;
            name: string;
            path: string;
            version: number | null;
            language?: { name?: string } | null;
            updated?: { value?: string } | null;
            updatedBy?: { value?: string } | null;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      } | null)?.items;
    return {
      items: (items?.nodes ?? []).map((n) => ({
        itemId: normalizeId(n.itemId),
        name: n.name,
        path: n.path,
        language: n.language?.name ?? 'en',
        version: n.version ?? null,
        updatedAt: parseSitecoreDate(n.updated?.value),
        updatedBy: n.updatedBy?.value || null,
      })),
      hasNextPage: items?.pageInfo?.hasNextPage === true,
      endCursor: items?.pageInfo?.endCursor ?? null,
    };
  }

  async getStateCommands(workflowId: string, stateId: string): Promise<WorkflowCommandInfo[]> {
    const data = await this.graphql(
      `query StateCommands($workflowId: String!, $stateId: String!) {
        workflow(where: { workflowId: $workflowId }) {
          commands(query: { stateId: $stateId }) {
            nodes { commandId displayName suppressComments }
          }
        }
      }`,
      { workflowId, stateId },
    );
    const nodes =
      (data['workflow'] as {
        commands?: { nodes?: Array<{ commandId: string; displayName: string; suppressComments: boolean }> };
      } | null)?.commands?.nodes ?? [];
    // Hide Sitecore-internal commands (e.g. __OnSave) that editors never
    // trigger manually.
    return nodes
      .filter((c) => !c.displayName.startsWith('__'))
      .map((c) => ({
        commandId: normalizeId(c.commandId),
        displayName: c.displayName,
        suppressComments: c.suppressComments,
      }));
  }

  async getItemHistory(
    workflowId: string,
    itemId: string,
    language: string,
  ): Promise<WorkflowHistoryEvent[]> {
    const data = await this.graphql(
      `query ItemHistory($workflowId: String!, $itemId: ID!, $language: String!) {
        workflow(where: { workflowId: $workflowId }) {
          history(item: { itemId: $itemId, language: $language }) {
            nodes {
              date
              user
              oldState { displayName }
              newState { displayName }
              comments
            }
          }
        }
      }`,
      { workflowId, itemId, language },
    );
    const nodes =
      (data['workflow'] as {
        history?: {
          nodes?: Array<{
            date?: string | null;
            user?: string | null;
            oldState?: { displayName?: string } | null;
            newState?: { displayName?: string } | null;
            comments?: string[];
          }>;
        };
      } | null)?.history?.nodes ?? [];
    return nodes.map((n) => ({
      date: n.date ?? null,
      user: n.user ?? null,
      oldState: n.oldState?.displayName ?? null,
      newState: n.newState?.displayName ?? null,
      comments: (n.comments ?? []).filter((c) => c.trim().length > 0),
    }));
  }

  async executeCommand(args: ExecuteCommandArgs): Promise<CommandResult> {
    const data = await this.graphql(
      `mutation ExecuteWorkflowCommand($input: ExecuteWorkflowCommandInput!) {
        executeWorkflowCommand(input: $input) {
          completed
          successful
          error
          message
          nextStateId
        }
      }`,
      {
        input: {
          commandId: args.commandId,
          comments: args.comments?.trim() ? args.comments.trim() : undefined,
          item: {
            itemId: args.itemId,
            language: args.language,
            ...(args.version != null ? { version: args.version } : {}),
          },
        },
      },
    );
    const payload = data['executeWorkflowCommand'] as {
      completed?: boolean;
      successful?: boolean;
      error?: string | null;
      message?: string | null;
      nextStateId?: string | null;
    } | null;
    if (!payload) {
      throw new Error('Sitecore did not confirm the workflow command.');
    }
    return {
      completed: payload.completed === true,
      successful: payload.successful === true,
      error: payload.error ?? null,
      message: payload.message ?? null,
      nextStateId: payload.nextStateId ? normalizeId(payload.nextStateId) : null,
    };
  }

  /* ---------------- Page builder companion ---------------- */

  subscribePageContext(listener: (page: PageContextInfo | null) => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    const emit = (data: unknown) => {
      if (!stopped) listener(pageContextFrom(data));
    };
    void this.client
      .query('pages.context', {
        subscribe: true,
        onSuccess: emit,
        onError: () => {
          if (!stopped) listener(null);
        },
      })
      .then((result) => {
        if (stopped) {
          result.unsubscribe?.();
          return;
        }
        unsubscribe = result.unsubscribe;
        if (result.data !== undefined) emit(result.data);
      })
      .catch(() => {
        if (!stopped) listener(null);
      });
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }

  subscribeContentUpdates(listener: () => void): () => void {
    const unsubs = [
      this.client.subscribe('pages.content.fieldsUpdated', { onData: () => listener() }),
      this.client.subscribe('pages.content.layoutUpdated', { onData: () => listener() }),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  async getItemWorkflowStatus(
    itemId: string,
    language: string,
  ): Promise<ItemWorkflowStatus | null> {
    const data = await this.graphql(
      `query ItemWorkflowStatus($itemId: ID!, $language: String!) {
        item(where: { itemId: $itemId, language: $language }) {
          itemId
          name
          path
          version
          language { name }
          updated: field(name: "__Updated") { value }
          workflow {
            workflow { workflowId displayName }
            workflowState { stateId displayName final }
          }
        }
      }`,
      { itemId, language },
    );
    const item = data['item'] as {
      itemId: string;
      name: string;
      path: string;
      version: number | null;
      language?: { name?: string } | null;
      updated?: { value?: string } | null;
      workflow?: {
        workflow?: { workflowId: string; displayName: string } | null;
        workflowState?: { stateId: string; displayName: string; final: boolean | null } | null;
      } | null;
    } | null;
    if (!item) return null;
    const wf = item.workflow?.workflow;
    const state = item.workflow?.workflowState;
    return {
      itemId: normalizeId(item.itemId),
      name: item.name,
      path: item.path,
      language: item.language?.name ?? language,
      version: item.version ?? null,
      updatedAt: parseSitecoreDate(item.updated?.value),
      workflow: wf ? { workflowId: normalizeId(wf.workflowId), displayName: wf.displayName } : null,
      state: state
        ? {
            stateId: normalizeId(state.stateId),
            displayName: state.displayName,
            final: state.final === true,
          }
        : null,
    };
  }

  /* ---------------- Brand Review (advisory AI quality checks) ---------------- */

  async getBrandReviewSupport(): Promise<BrandReviewSupport> {
    try {
      const result = await this.client.query('xmc.sites.listSites', {
        params: { query: { sitecoreContextId: this.sitecoreContextId } },
      });
      const payload = (result as { data?: unknown }).data ?? result;
      const sites = (Array.isArray(payload)
        ? payload
        : ((payload as { data?: unknown[] })?.data ?? [])) as Array<{
        name?: string;
        brandKitId?: string | null;
      }>;
      const withKit = sites.find((site) => site.brandKitId);
      if (!withKit?.brandKitId) {
        return {
          available: false,
          brandKitId: null,
          message:
            'No brand kit is connected to any site in this environment. Connect a brand kit in Sitecore to enable AI quality checks.',
        };
      }
      return { available: true, brandKitId: withKit.brandKitId, message: null };
    } catch (error) {
      return {
        available: false,
        brandKitId: null,
        message: `Could not determine Brand Review availability: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  async getItemReviewContent(itemId: string, language: string): Promise<ReviewContent | null> {
    const data = await this.graphql(
      `query ItemReviewContent($itemId: ID!, $language: String!) {
        item(where: { itemId: $itemId, language: $language }) {
          itemId
          name
          version
          updated: field(name: "__Updated") { value }
          fields(ownFields: true) { nodes { name value } }
          children(first: 30) {
            nodes {
              name
              template { name }
              fields(ownFields: true) { nodes { name value } }
              children(first: 30) {
                nodes {
                  name
                  template { name }
                  fields(ownFields: true) { nodes { name value } }
                }
              }
            }
          }
        }
      }`,
      { itemId, language },
    );
    interface ReviewNode {
      name: string;
      template?: { name?: string } | null;
      fields?: { nodes?: Array<{ name: string; value?: string | null }> };
      children?: { nodes?: ReviewNode[] };
    }
    const item = data['item'] as
      | (ReviewNode & {
          itemId: string;
          version: number | null;
          updated?: { value?: string } | null;
        })
      | null;
    if (!item) return null;

    const entries: ReviewContentEntry[] = [];
    for (const field of item.fields?.nodes ?? []) {
      if (!isReviewableFieldName(field.name)) continue;
      const text = extractPlainText(field.value);
      if (text) entries.push({ source: 'field', label: field.name, text });
    }
    // Datasource selection rule: only descendants that are actual local
    // datasources are submitted — direct children whose template classifies
    // as a component, plus component items inside a direct "Data" folder
    // (the SXA local-datasource convention). Child pages, folders of other
    // kinds, and anything deeper are excluded so unrelated content never
    // leaves the item's own scope.
    const addDatasource = (node: ReviewNode) => {
      for (const field of node.fields?.nodes ?? []) {
        if (!isReviewableFieldName(field.name)) continue;
        const text = extractPlainText(field.value);
        if (text) {
          entries.push({ source: 'datasource', label: `${node.name} · ${field.name}`, text });
        }
      }
    };
    for (const child of item.children?.nodes ?? []) {
      const kind = classifyTemplate(child.template?.name ?? '');
      if (kind === 'component') {
        addDatasource(child);
      } else if (kind === 'folder' && /^data$/i.test(child.name)) {
        for (const grandchild of child.children?.nodes ?? []) {
          if (classifyTemplate(grandchild.template?.name ?? '') === 'component') {
            addDatasource(grandchild);
          }
        }
      }
    }
    const limited = limitReviewEntries(entries);
    return {
      itemId: normalizeId(item.itemId),
      language,
      version: item.version ?? null,
      updatedAt: parseSitecoreDate(item.updated?.value),
      entries: limited.entries,
      truncated: limited.truncated,
    };
  }

  async generateBrandReview(
    brandKitId: string,
    content: ReviewContent,
  ): Promise<BrandReviewSectionResult[]> {
    // Read-only with respect to Sitecore: this generates an analysis of
    // the submitted text and never touches content or workflow state.
    const input: Record<string, string> = {};
    content.entries.forEach((entry, index) => {
      // Keys must be unique and stable; the API echoes them as fieldIds.
      input[`${index + 1}. ${entry.label}`] = entry.text;
    });
    if (Object.keys(input).length === 0) {
      throw new Error('This item has no reviewable text content.');
    }
    const result = await this.client.mutate('ai.skills.generateBrandReview', {
      params: {
        query: { sitecoreContextId: this.sitecoreContextId },
        body: { brandkitId: brandKitId, input },
      },
    });
    const payload = (result as { data?: unknown }).data ?? result;
    const reviews = ((payload as { reviews?: unknown[] })?.reviews ??
      ((payload as { data?: { reviews?: unknown[] } })?.data?.reviews ?? [])) as Array<{
      sectionId?: string;
      score?: number;
      reason?: string;
      suggestion?: string;
      fields?: Array<{ fieldId?: string; score?: number; reason?: string; suggestion?: string }>;
    }>;
    if (!Array.isArray(reviews) || reviews.length === 0) {
      throw new Error('Brand Review returned no analysis for this content.');
    }
    return reviews.map((section, i) => ({
      sectionId: section.sectionId ?? `section-${i + 1}`,
      score: typeof section.score === 'number' ? section.score : 0,
      reason: section.reason ?? '',
      suggestion: section.suggestion ?? '',
      fields: (section.fields ?? []).map((field, j) => ({
        fieldId: field.fieldId ?? `field-${j + 1}`,
        score: typeof field.score === 'number' ? field.score : 0,
        reason: field.reason ?? '',
        suggestion: field.suggestion ?? '',
      })),
    }));
  }

  async createDraftWorkflow(spec: DraftWorkflowSpec): Promise<{ workflowId: string }> {
    const problems = validateDraftWorkflow(spec);
    if (problems.length > 0) {
      throw new Error(problems.join(' '));
    }

    // Resolve the standard workflow templates and the /sitecore/system
    // Workflows root by path — template ids can differ per environment.
    const lookup = await this.graphql(
      `query WorkflowTemplates {
        wf: item(where: { path: "/sitecore/templates/System/Workflow/Workflow", language: "en" }) { itemId }
        st: item(where: { path: "/sitecore/templates/System/Workflow/State", language: "en" }) { itemId }
        cmd: item(where: { path: "/sitecore/templates/System/Workflow/Command", language: "en" }) { itemId }
        root: item(where: { path: "/sitecore/system/Workflows", language: "en" }) { itemId }
      }`,
      {},
    );
    const idOf = (key: string): string => {
      const node = lookup[key] as { itemId?: string } | null;
      if (!node?.itemId) {
        throw new Error(
          'This environment does not expose the standard Sitecore workflow templates, so the builder cannot create workflows here.',
        );
      }
      return normalizeId(node.itemId);
    };
    const templates = { workflow: idOf('wf'), state: idOf('st'), command: idOf('cmd') };
    const rootId = idOf('root');

    const createItem = async (
      name: string,
      templateId: string,
      parent: string,
      fields: Array<{ name: string; value: string }>,
    ): Promise<string> => {
      const data = await this.graphql(
        `mutation CreateWorkflowPart($input: CreateItemInput!) {
          createItem(input: $input) { item { itemId } }
        }`,
        { input: { name, templateId, parent, language: 'en', fields } },
      );
      const itemId = (data['createItem'] as { item?: { itemId?: string } | null } | null)?.item
        ?.itemId;
      if (!itemId) {
        throw new Error(`Sitecore did not confirm creating "${name}".`);
      }
      return normalizeId(itemId);
    };

    // The Authoring API has no transactional or delete support for these
    // items, so a mid-build failure would leave a partial definition behind.
    // Wrap every step so the error tells the editor exactly what exists and
    // how to clean it up before retrying — never silently retry as new.
    // 1. Workflow root item.
    let workflowId: string;
    try {
      workflowId = await createItem(spec.name.trim(), templates.workflow, rootId, []);
    } catch (error) {
      throw new Error(
        `Creating the workflow failed before anything was written: ${errorMessage(error)}`,
      );
    }
    const partialHint = `A partial workflow "${spec.name.trim()}" now exists under /sitecore/system/Workflows — delete it in the Content Editor before trying again.`;
    // 2. States.
    const stateIds = new Map<string, string>();
    for (const state of spec.states) {
      try {
        const stateId = await createItem(
          state.name.trim(),
          templates.state,
          workflowId,
          state.final ? [{ name: 'Final', value: '1' }] : [],
        );
        stateIds.set(state.key, stateId);
      } catch (error) {
        throw new Error(
          `Creating state "${state.name.trim()}" failed: ${errorMessage(error)} ${partialHint}`,
        );
      }
    }
    // 3. Transition commands under their source state.
    for (const t of spec.transitions) {
      const fromId = stateIds.get(t.fromKey);
      const toId = stateIds.get(t.toKey);
      if (!fromId || !toId) continue; // Guarded by validation above.
      try {
        await createItem(t.name.trim(), templates.command, fromId, [
          { name: 'Next state', value: toId },
        ]);
      } catch (error) {
        throw new Error(
          `Creating transition "${t.name.trim()}" failed: ${errorMessage(error)} ${partialHint}`,
        );
      }
    }
    // 4. Point the workflow at its initial state.
    const initial = spec.states.find((s) => s.initial);
    const initialId = initial ? stateIds.get(initial.key) : undefined;
    if (initialId) {
      try {
        await this.graphql(
          `mutation SetInitialState($input: UpdateItemInput!) {
            updateItem(input: $input) { item { itemId } }
          }`,
          {
            input: {
              itemId: workflowId,
              language: 'en',
              fields: [{ name: 'Initial state', value: initialId }],
            },
          },
        );
      } catch (error) {
        throw new Error(
          `The workflow and its states were created, but setting the initial state failed: ${errorMessage(error)} Set the "Initial state" field on the workflow item in the Content Editor.`,
        );
      }
    }
    return { workflowId };
  }

  /* ---------------- Definition management (verified ops only) ---------------- */

  async getWorkflowGraph(workflowId: string): Promise<WorkflowGraph> {
    // A workflow definition is a regular item tree: workflow → states →
    // commands (with a "Next state" field). One nested children query
    // returns the whole graph.
    const data = await this.graphql(
      `query WorkflowGraph($itemId: ID!) {
        item(where: { itemId: $itemId, language: "en" }) {
          itemId
          children {
            nodes {
              itemId
              name
              template { name }
              final: field(name: "Final") { value }
              children {
                nodes {
                  itemId
                  name
                  template { name }
                  nextState: field(name: "Next state") { value }
                }
              }
            }
          }
        }
      }`,
      { itemId: workflowId },
    );
    interface Node {
      itemId: string;
      name: string;
      template?: { name?: string } | null;
      final?: { value?: string } | null;
      nextState?: { value?: string } | null;
      children?: { nodes?: Node[] };
    }
    const item = data['item'] as Node | null;
    if (!item) {
      throw new Error('This workflow definition could not be read.');
    }
    // Cross-check with the workflow query so `initial` stays authoritative.
    const workflows = await this.listWorkflows();
    const info = workflows.find((w) => w.workflowId === normalizeId(workflowId));
    const initialId = info?.states.find((s) => s.initial)?.stateId ?? null;

    const states = (item.children?.nodes ?? [])
      .filter((n) => n.template?.name === 'State')
      .map((n) => ({
        stateId: normalizeId(n.itemId),
        displayName: n.name,
        final: n.final?.value === '1',
        initial: normalizeId(n.itemId) === initialId,
      }));
    const transitions = (item.children?.nodes ?? [])
      .filter((n) => n.template?.name === 'State')
      .flatMap((state) =>
        (state.children?.nodes ?? [])
          .filter((c) => c.template?.name === 'Command' && !c.name.startsWith('__'))
          .map((c) => ({
            commandId: normalizeId(c.itemId),
            displayName: c.name,
            fromStateId: normalizeId(state.itemId),
            toStateId: c.nextState?.value ? normalizeId(c.nextState.value) : null,
          })),
      );
    return { workflowId: normalizeId(workflowId), states, transitions };
  }

  async addState(
    workflowId: string,
    name: string,
    final: boolean,
  ): Promise<{ stateId: string }> {
    const templateId = await this.resolveTemplateId(
      '/sitecore/templates/System/Workflow/State',
    );
    const data = await this.graphql(
      `mutation AddWorkflowState($input: CreateItemInput!) {
        createItem(input: $input) { item { itemId } }
      }`,
      {
        input: {
          name: name.trim(),
          templateId,
          parent: workflowId,
          language: 'en',
          fields: final ? [{ name: 'Final', value: '1' }] : [],
        },
      },
    );
    const stateId = (data['createItem'] as { item?: { itemId?: string } | null } | null)?.item
      ?.itemId;
    if (!stateId) throw new Error(`Sitecore did not confirm creating state "${name}".`);
    return { stateId: normalizeId(stateId) };
  }

  async addTransition(
    fromStateId: string,
    name: string,
    toStateId: string,
  ): Promise<{ commandId: string }> {
    const templateId = await this.resolveTemplateId(
      '/sitecore/templates/System/Workflow/Command',
    );
    const data = await this.graphql(
      `mutation AddWorkflowCommand($input: CreateItemInput!) {
        createItem(input: $input) { item { itemId } }
      }`,
      {
        input: {
          name: name.trim(),
          templateId,
          parent: fromStateId,
          language: 'en',
          fields: [{ name: 'Next state', value: toStateId }],
        },
      },
    );
    const commandId = (data['createItem'] as { item?: { itemId?: string } | null } | null)?.item
      ?.itemId;
    if (!commandId) throw new Error(`Sitecore did not confirm creating command "${name}".`);
    return { commandId: normalizeId(commandId) };
  }

  async deleteDefinitionItem(itemId: string): Promise<void> {
    // Never permanent: without `permanently` the item moves to the Sitecore
    // recycle bin and can be restored in the Content Editor.
    const data = await this.graphql(
      `mutation DeleteWorkflowPart($input: DeleteItemInput!) {
        deleteItem(input: $input) { successful }
      }`,
      { input: { itemId } },
    );
    const successful = (data['deleteItem'] as { successful?: boolean } | null)?.successful;
    if (successful !== true) {
      throw new Error('Sitecore did not confirm the deletion.');
    }
  }

  /* ---------------- Content browsing & workflow assignment ---------------- */

  /** Fields queried for every node in the assignment browser. */
  private static readonly CONTENT_ITEM_FIELDS = `
    itemId
    name
    path
    version
    hasChildren
    template { name }
    language { name }
    wf: field(name: "__Workflow") { value }
    wfState: field(name: "__Workflow state") { value }
  `;

  private toContentItem(
    node: {
      itemId: string;
      name: string;
      path: string;
      version?: number | null;
      hasChildren?: boolean | null;
      template?: { name?: string } | null;
      language?: { name?: string } | null;
      wf?: { value?: string } | null;
      wfState?: { value?: string } | null;
    },
    workflowNames: Map<string, { displayName: string; states: Map<string, string> }>,
  ): ContentItem {
    const wfId = node.wf?.value ? normalizeId(node.wf.value) : null;
    const stId = node.wfState?.value ? normalizeId(node.wfState.value) : null;
    const wfInfo = wfId ? workflowNames.get(wfId) : undefined;
    return {
      itemId: normalizeId(node.itemId),
      name: node.name,
      path: node.path,
      templateName: node.template?.name ?? 'Unknown',
      kind: classifyTemplate(node.template?.name ?? ''),
      hasChildren: node.hasChildren === true,
      language: node.language?.name ?? LANGUAGE,
      version: node.version ?? null,
      workflow: wfId ? { workflowId: wfId, displayName: wfInfo?.displayName ?? wfId } : null,
      workflowState: stId
        ? { stateId: stId, displayName: wfInfo?.states.get(stId) ?? stId }
        : null,
    };
  }

  /** workflowId → display names, for labelling item workflow metadata. */
  private async workflowNameMap(): Promise<
    Map<string, { displayName: string; states: Map<string, string> }>
  > {
    const workflows = await this.listWorkflows();
    return new Map(
      workflows.map((wf) => [
        wf.workflowId,
        {
          displayName: wf.displayName,
          states: new Map(wf.states.map((s) => [s.stateId, s.displayName] as const)),
        },
      ]),
    );
  }

  async getContentChildren(parentId: string | null): Promise<ContentItem[]> {
    const where = parentId
      ? `{ itemId: $ref, language: "${LANGUAGE}" }`
      : `{ path: $ref, language: "${LANGUAGE}" }`;
    const [data, names] = await Promise.all([
      this.graphql(
        `query ContentChildren($ref: ${parentId ? 'ID!' : 'String!'}) {
          item(where: ${where}) {
            children(first: 50) {
              nodes { ${SdkMarketplaceHost.CONTENT_ITEM_FIELDS} }
            }
          }
        }`,
        { ref: parentId ?? '/sitecore/content' },
      ),
      this.workflowNameMap(),
    ]);
    const nodes =
      (data['item'] as {
        children?: { nodes?: Array<Parameters<SdkMarketplaceHost['toContentItem']>[0]> };
      } | null)?.children?.nodes ?? [];
    return nodes.map((n) => this.toContentItem(n, names));
  }

  async getContentItems(itemIds: string[]): Promise<ContentItem[]> {
    if (itemIds.length === 0) return [];
    const names = await this.workflowNameMap();
    // One aliased query; items that no longer exist come back null and are
    // omitted — the caller treats them as stale, never substitutes.
    const aliases = itemIds
      .map((_, i) => `i${i}: item(where: { itemId: $id${i}, language: "${LANGUAGE}" }) { ${SdkMarketplaceHost.CONTENT_ITEM_FIELDS} }`)
      .join('\n');
    const varDefs = itemIds.map((_, i) => `$id${i}: ID!`).join(', ');
    const variables: Record<string, unknown> = {};
    itemIds.forEach((id, i) => {
      variables[`id${i}`] = id;
    });
    const data = await this.graphql(`query ResolveItems(${varDefs}) { ${aliases} }`, variables);
    const items: ContentItem[] = [];
    itemIds.forEach((_, i) => {
      const node = data[`i${i}`] as Parameters<SdkMarketplaceHost['toContentItem']>[0] | null;
      if (node) items.push(this.toContentItem(node, names));
    });
    return items;
  }

  async assignWorkflow(items: ContentItem[], workflowId: string): Promise<AssignmentResult[]> {
    if (items.length === 0) return [];
    if (items.length > MAX_ASSIGN_SELECTION) {
      throw new Error(
        `Refusing to assign a workflow to ${items.length} items — the limit is ${MAX_ASSIGN_SELECTION} per operation.`,
      );
    }
    // Fail closed: without a verified initial state there is nothing safe
    // to write into "__Workflow state".
    const workflows = await this.listWorkflows();
    const wf = workflows.find((w) => w.workflowId === normalizeId(workflowId));
    const initial = wf?.states.find((s) => s.initial);
    if (!wf || !initial) {
      throw new Error(
        'The workflow or its initial state could not be verified against Sitecore, so nothing was assigned.',
      );
    }
    const results: AssignmentResult[] = [];
    for (const item of items) {
      try {
        await this.graphql(
          `mutation AssignWorkflow($input: UpdateItemInput!) {
            updateItem(input: $input) { item { itemId } }
          }`,
          {
            input: {
              itemId: item.itemId,
              language: item.language || LANGUAGE,
              fields: [
                { name: '__Workflow', value: wf.workflowId },
                { name: '__Workflow state', value: initial.stateId },
              ],
            },
          },
        );
        results.push({
          itemId: item.itemId,
          name: item.name,
          path: item.path,
          successful: true,
          error: null,
        });
      } catch (error) {
        // Record and continue — never retry, never widen.
        results.push({
          itemId: item.itemId,
          name: item.name,
          path: item.path,
          successful: false,
          error: errorMessage(error),
        });
      }
    }
    return results;
  }

  private async resolveTemplateId(path: string): Promise<string> {
    const data = await this.graphql(
      `query ResolveTemplate($path: String!) {
        item(where: { path: $path, language: "en" }) { itemId }
      }`,
      { path },
    );
    const itemId = (data['item'] as { itemId?: string } | null)?.itemId;
    if (!itemId) {
      throw new Error(
        'This environment does not expose the standard Sitecore workflow templates.',
      );
    }
    return normalizeId(itemId);
  }

  destroy(): void {
    this.client.destroy();
  }
}
