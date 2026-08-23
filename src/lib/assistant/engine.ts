import type {
  WorkflowGraph,
  WorkflowInfo,
  WorkflowStateInfo,
} from '@/lib/workflow/types';
import { validateDraftWorkflow } from '@/lib/workflow/types';
import type {
  AssistantConversation,
  AssistantContext,
  AssistantProposal,
  AssistantReply,
} from './types';

/**
 * Deterministic, rule-based intent parser. It maps a user message onto
 * either an informational reply (built from real host data) or a
 * structured proposal for one of the mutations the app already supports.
 *
 * It NEVER fabricates ids: workflows and states are resolved against the
 * live context by name, and transition deletion resolves the real
 * commandId from the loaded definition graph. When something cannot be
 * resolved it says so instead of guessing.
 */

const CAPABILITIES_TEXT =
  'I can help you understand and change Sitecore workflows. Try:\n' +
  '• "show my workflows"\n' +
  '• "explain the Sample Workflow"\n' +
  '• "create a workflow called Legal Review with states Draft, In Review, Approved"\n' +
  '• "add a state called Legal Check to Sample Workflow"\n' +
  '• "add a transition called Escalate from Draft to Approved in Sample Workflow"\n' +
  '• "delete the Reject transition in Sample Workflow"\n' +
  '• "what commands are available in Awaiting Approval?"\n' +
  'Every change is shown as a proposal you review and confirm — nothing is applied automatically.';

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Find a workflow by name. Strict on purpose: when the user names a
 * workflow, only that name may match — we never silently substitute
 * "the only workflow" for a name that didn't resolve, because a
 * mutation would then target an object the user never mentioned.
 */
export function resolveWorkflow(
  ctx: AssistantContext,
  name: string | undefined,
): { workflow?: WorkflowInfo; ambiguous?: WorkflowInfo[]; unknown?: string } {
  const workflows = ctx.workflows;
  if (!name || !name.trim()) {
    if (workflows.length === 1) return { workflow: workflows[0] };
    return {};
  }
  const n = norm(name);
  const exact = workflows.filter((w) => norm(w.displayName) === n);
  if (exact.length === 1) return { workflow: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  const partial = workflows.filter(
    (w) => norm(w.displayName).includes(n) || n.includes(norm(w.displayName)),
  );
  if (partial.length === 1) return { workflow: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return { unknown: name.trim() };
}

/**
 * Resolve a state by name. Exact match wins; otherwise a partial match
 * is accepted only when it is unique — multiple partial hits report
 * ambiguity instead of silently picking the first.
 */
function resolveState(
  states: WorkflowStateInfo[],
  name: string,
): { state?: WorkflowStateInfo; ambiguous?: WorkflowStateInfo[] } {
  const n = norm(name);
  const exact = states.filter((s) => norm(s.displayName) === n);
  if (exact.length === 1) return { state: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  const partial = states.filter(
    (s) => norm(s.displayName).includes(n) || n.includes(norm(s.displayName)),
  );
  if (partial.length === 1) return { state: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return {};
}

/** Try to find which workflow a state name belongs to (unique match only). */
function findStateAcrossWorkflows(
  ctx: AssistantContext,
  stateName: string,
): { workflow: WorkflowInfo; state: WorkflowStateInfo } | undefined {
  const hits: { workflow: WorkflowInfo; state: WorkflowStateInfo }[] = [];
  for (const wf of ctx.workflows) {
    const { state } = resolveState(wf.states, stateName);
    if (state) hits.push({ workflow: wf, state });
  }
  return hits.length === 1 ? hits[0] : undefined;
}

function splitList(raw: string): string[] {
  return raw
    .split(/,| and | then |→|->/i)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Strip surrounding quotes from a captured fragment. */
function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '').trim();
}

let draftKey = 0;
function nextDraftKey(): string {
  draftKey += 1;
  return `a${draftKey}`;
}

function buildCreateProposal(name: string, stateNames: string[]): AssistantProposal {
  const states = (stateNames.length >= 2
    ? stateNames
    : ['Draft', 'Awaiting Approval', 'Approved']
  ).map((s, i, arr) => ({
    key: nextDraftKey(),
    name: s,
    initial: i === 0,
    final: i === arr.length - 1,
  }));
  const transitions = [] as { name: string; fromKey: string; toKey: string }[];
  for (let i = 0; i < states.length - 1; i++) {
    transitions.push({
      name: i === states.length - 2 ? 'Approve' : i === 0 ? 'Submit' : `Advance ${i + 1}`,
      fromKey: states[i]!.key,
      toKey: states[i + 1]!.key,
    });
  }
  // A review flow needs a way back: reject from the state before final to the first.
  if (states.length >= 3) {
    transitions.push({
      name: 'Reject',
      fromKey: states[states.length - 2]!.key,
      toKey: states[0]!.key,
    });
  }
  return { kind: 'create-workflow', spec: { name, states, transitions } };
}

function graphFor(ctx: AssistantContext, workflowId: string): WorkflowGraph | undefined {
  return ctx.graphs[workflowId];
}

function selectedWorkflow(
  ctx: AssistantContext,
  conversation: AssistantConversation | undefined,
): WorkflowInfo | undefined {
  return conversation?.selectedWorkflowId
    ? ctx.workflows.find((workflow) => workflow.workflowId === conversation.selectedWorkflowId)
    : undefined;
}

function explainWorkflow(workflow: WorkflowInfo, ctx: AssistantContext): AssistantReply {
  const graph = graphFor(ctx, workflow.workflowId);
  const initial = workflow.states.find((state) => state.initial);
  const finals = workflow.states.filter((state) => state.final);
  return {
    text: `"${workflow.displayName}" has ${workflow.states.length} states. Content starts in "${initial?.displayName ?? 'an initial state'}" and is publishable once it reaches ${finals.length > 0 ? finals.map((state) => `"${state.displayName}"`).join(' or ') : 'a final state'}.${graph ? ` It has ${graph.transitions.length} transitions.` : ''} Ask me about any state, its available commands, or how to change this workflow.`,
    embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
    conversation: { selectedWorkflowId: workflow.workflowId },
  };
}

function stateGuidance(workflow: WorkflowInfo | undefined): AssistantReply {
  const workflowContext = workflow
    ? ` For "${workflow.displayName}", its current states are ${workflow.states.map((state) => `"${state.displayName}"`).join(', ')}.`
    : '';
  return {
    text:
      'A workflow state is a named place where content waits in a process. This workspace supports three useful roles: one initial state where new content begins, one or more working/review states, and one or more final states where content is ready to publish. For a simple 3-state flow, use Draft → In Review → Approved. Other useful patterns are Draft → Legal Review → Approved, or Draft → Editorial Review → Ready to Publish. You can choose the names that fit your team; mark only the beginning state as initial and the completed outcome as final.' +
      workflowContext,
    conversation: workflow ? { selectedWorkflowId: workflow.workflowId } : undefined,
  };
}

export function parseMessage(
  input: string,
  ctx: AssistantContext,
  conversation?: AssistantConversation,
): AssistantReply {
  const msg = norm(input);
  if (!msg) return { text: CAPABILITIES_TEXT, embed: { kind: 'capabilities' } };
  const currentWorkflow = selectedWorkflow(ctx, conversation);

  // --- Help / capabilities ------------------------------------------------
  if (/^(help|what can you do|capabilities|hi|hello|hey)\b/.test(msg) || msg === '?') {
    return { text: CAPABILITIES_TEXT, embed: { kind: 'capabilities' } };
  }

  // --- Learn workflow concepts ---------------------------------------------
  if (
    /\b(?:what|which|kind|types?)\b.*\bstates?\b.*\b(?:create|use|have|are)\b/.test(msg) ||
    /\b(?:what|which|kind|types?)\b.*\bstate\b/.test(msg)
  ) {
    return stateGuidance(currentWorkflow);
  }
  if (/^(?:(?:i want|use|make|create)\s+)?(?:3|three)\s+states?\b/.test(msg)) {
    return {
      text: `A 3-state workflow is a clear starting point: Draft → In Review → Approved. Draft is the initial state, In Review is where people make a decision, and Approved is final. Add a Reject transition from In Review back to Draft so editors can revise. Say “create a workflow called Content Review with states Draft, In Review, Approved” when you’re ready for a reviewable proposal.${currentWorkflow ? ` I can also help adapt "${currentWorkflow.displayName}".` : ''}`,
      conversation: currentWorkflow
        ? { selectedWorkflowId: currentWorkflow.workflowId }
        : undefined,
    };
  }

  // A workflow-name-only response is a valid answer to a prior ambiguity
  // question and is also a useful direct shortcut to an explanation.
  const namedWorkflow = resolveWorkflow(ctx, input);
  const isBareWorkflowSelection =
    !/\b(?:create|add|delete|remove|explain|describe|show|open|tell|what|which|help|commands?|states?|transitions?)\b/.test(
      msg,
    );
  if (
    isBareWorkflowSelection &&
    namedWorkflow.workflow &&
    (!conversation?.awaitingWorkflowIds ||
      conversation.awaitingWorkflowIds.includes(namedWorkflow.workflow.workflowId))
  ) {
    return explainWorkflow(namedWorkflow.workflow, ctx);
  }
  if (
    currentWorkflow &&
    /^(?:explain|describe|show|open|tell me about)(?:\s+(?:it|this|that|the selected workflow))?\??$/.test(msg)
  ) {
    return explainWorkflow(currentWorkflow, ctx);
  }

  // --- Create workflow ----------------------------------------------------
  {
    const m = input.match(
      /create\s+(?:a\s+|new\s+)?workflow(?:\s+(?:called|named))?\s+"?([^"]+?)"?(?:\s+with\s+(?:the\s+)?states?\s+(.+))?$/i,
    );
    if (m) {
      const rawName = unquote(m[1]!.replace(/\s+with\s+(?:the\s+)?states?\s+.+$/i, ''));
      const stateNames = m[2] ? splitList(m[2]) : [];
      const proposal = buildCreateProposal(rawName, stateNames);
      if (proposal.kind !== 'create-workflow') throw new Error('unreachable');
      const problems = validateDraftWorkflow(proposal.spec);
      const duplicate = ctx.workflows.some(
        (w) => norm(w.displayName) === norm(rawName),
      );
      if (duplicate) {
        return {
          text: `A workflow named "${rawName}" already exists. Pick a different name and I’ll draft it.`,
        };
      }
      if (problems.length > 0) {
        return { text: `I can’t draft that workflow yet: ${problems.join(' ')}` };
      }
      return {
        text:
          stateNames.length >= 2
            ? `Here’s a draft of "${rawName}" with the states you listed and standard forward/reject transitions. Review the diagram and confirm to create it in Sitecore.`
            : `Here’s a starter review flow named "${rawName}" (Draft → Awaiting Approval → Approved). Review and confirm to create it in Sitecore.`,
        proposal,
      };
    }
  }

  // --- Add state ------------------------------------------------------------
  {
    const m = input.match(
      /add\s+(?:a\s+)?(final\s+)?state\s+(?:called|named)?\s*"?([^"]+?)"?(?:\s+(?:to|in)\s+(?:the\s+)?"?([^"]+?)"?)?\s*$/i,
    );
    if (m) {
      const finalFlag = !!m[1] || /\bfinal\b/i.test(input);
      const stateName = unquote(m[2]!);
      const requestedWorkflowName = m[3] ? unquote(m[3]) : undefined;
      const resolved = requestedWorkflowName
        ? resolveWorkflow(ctx, requestedWorkflowName)
        : { workflow: currentWorkflow } as ReturnType<typeof resolveWorkflow>;
      const { workflow, ambiguous, unknown } = resolved;
      if (ambiguous) {
        return {
          text: `Which workflow do you mean: ${ambiguous.map((w) => `"${w.displayName}"`).join(', ')}?`,
        };
      }
      if (unknown) {
        return {
          text: `I couldn’t find a workflow named "${unknown}". Your workflows are: ${ctx.workflows.map((w) => `"${w.displayName}"`).join(', ') || 'none'}.`,
        };
      }
      if (!workflow) {
        return { text: 'Which workflow should the state be added to? Say e.g. "add a state called Legal Check to Sample Workflow".' };
      }
      if (workflow.states.some((s) => norm(s.displayName) === norm(stateName))) {
        return {
          text: `"${workflow.displayName}" already has a state named "${stateName}".`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      return {
        text: `Proposal: add ${finalFlag ? 'a final' : 'a'} state "${stateName}" to "${workflow.displayName}". Confirm to create it in Sitecore. You can then wire it up with transitions.`,
        proposal: {
          kind: 'add-state',
          workflowId: workflow.workflowId,
          workflowName: workflow.displayName,
          stateName,
          final: finalFlag,
        },
      };
    }
  }

  // --- Add transition -------------------------------------------------------
  {
    const m = input.match(
      /add\s+(?:a\s+)?(?:transition|command)\s+(?:called|named)?\s*"?([^"]+?)"?\s+from\s+"?([^"]+?)"?\s+to\s+"?([^"]+?)"?(?:\s+(?:in|on)\s+(?:the\s+)?"?([^"]+?)"?)?\s*$/i,
    );
    if (m) {
      const cmdName = unquote(m[1]!);
      const fromName = unquote(m[2]!);
      const toName = unquote(m[3]!);
      let workflow: WorkflowInfo | undefined;
      if (m[4]) {
        // Explicit workflow name: it must resolve — never fall back to a
        // workflow the user did not name.
        const resolved = resolveWorkflow(ctx, unquote(m[4]));
        if (resolved.ambiguous) {
          return { text: `Which workflow: ${resolved.ambiguous.map((w) => `"${w.displayName}"`).join(', ')}?` };
        }
        if (!resolved.workflow) {
          return {
            text: `I couldn’t find a workflow named "${unquote(m[4])}". Your workflows are: ${ctx.workflows.map((w) => `"${w.displayName}"`).join(', ') || 'none'}.`,
          };
        }
        workflow = resolved.workflow;
      } else {
        workflow = currentWorkflow ?? findStateAcrossWorkflows(ctx, fromName)?.workflow;
      }
      if (!workflow) {
        return { text: `I couldn’t tell which workflow contains "${fromName}". Add "... in <workflow name>" and I’ll draft it.` };
      }
      const fromRes = resolveState(workflow.states, fromName);
      const toRes = resolveState(workflow.states, toName);
      const ambiguousState = fromRes.ambiguous ?? toRes.ambiguous;
      if (ambiguousState) {
        return {
          text: `Several states match that name in "${workflow.displayName}": ${ambiguousState.map((s) => `"${s.displayName}"`).join(', ')}. Use the exact state name.`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      const from = fromRes.state;
      const to = toRes.state;
      if (!from || !to) {
        return {
          text: `"${workflow.displayName}" has no state named "${!from ? fromName : toName}". Its states are: ${workflow.states.map((s) => s.displayName).join(', ')}.`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      if (from.stateId === to.stateId) {
        return { text: 'A transition must move content to a different state.' };
      }
      return {
        text: `Proposal: add command "${cmdName}" moving items from "${from.displayName}" to "${to.displayName}" in "${workflow.displayName}". Confirm to create it in Sitecore.`,
        proposal: {
          kind: 'add-transition',
          workflowId: workflow.workflowId,
          workflowName: workflow.displayName,
          commandName: cmdName,
          fromStateId: from.stateId,
          fromStateName: from.displayName,
          toStateId: to.stateId,
          toStateName: to.displayName,
        },
      };
    }
  }

  // --- Delete transition ------------------------------------------------------
  {
    const m = input.match(
      /(?:delete|remove)\s+(?:the\s+)?"?([^"]+?)"?\s+(?:transition|command)(?:\s+(?:in|from|of)\s+(?:the\s+)?"?([^"]+?)"?)?\s*$/i,
    );
    if (m) {
      const cmdName = unquote(m[1]!);
      const requestedWorkflowName = m[2] ? unquote(m[2]) : undefined;
      const resolved = requestedWorkflowName
        ? resolveWorkflow(ctx, requestedWorkflowName)
        : { workflow: currentWorkflow } as ReturnType<typeof resolveWorkflow>;
      const { workflow, ambiguous, unknown } = resolved;
      if (ambiguous) {
        return { text: `Which workflow: ${ambiguous.map((w) => `"${w.displayName}"`).join(', ')}?` };
      }
      if (unknown) {
        return {
          text: `I couldn’t find a workflow named "${unknown}". Your workflows are: ${ctx.workflows.map((w) => `"${w.displayName}"`).join(', ') || 'none'}.`,
        };
      }
      if (!workflow) {
        return { text: 'Tell me which workflow the transition belongs to, e.g. "delete the Reject transition in Sample Workflow".' };
      }
      const graph = graphFor(ctx, workflow.workflowId);
      if (!graph) {
        return {
          text: `I haven’t loaded the definition of "${workflow.displayName}" yet — open it once and ask again.`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      const matches = graph.transitions.filter((t) => norm(t.displayName) === norm(cmdName));
      if (matches.length === 0) {
        return {
          text: `"${workflow.displayName}" has no transition named "${cmdName}". Its transitions are: ${graph.transitions.map((t) => t.displayName).join(', ') || 'none'}.`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      if (matches.length > 1) {
        return {
          text: `There are ${matches.length} transitions named "${cmdName}" in "${workflow.displayName}". Delete the right one from the workflow page, where each is listed with its source state.`,
          embed: { kind: 'workflow-overview', workflowId: workflow.workflowId },
        };
      }
      const t = matches[0]!;
      const fromState = graph.states.find((s) => s.stateId === t.fromStateId);
      const toState = graph.states.find((s) => s.stateId === t.toStateId);
      return {
        text: `Proposal: delete the "${t.displayName}" transition (${fromState?.displayName ?? '?'} → ${toState?.displayName ?? 'stays in place'}) from "${workflow.displayName}". It goes to the Sitecore recycle bin and can be restored there.`,
        proposal: {
          kind: 'delete-transition',
          workflowId: workflow.workflowId,
          workflowName: workflow.displayName,
          commandId: t.commandId,
          commandName: t.displayName,
          fromStateName: fromState?.displayName ?? 'unknown',
          toStateName: toState?.displayName ?? '(stays in place)',
        },
        warnings: ['Editors lose this action immediately after the deletion.'],
      };
    }
  }

  // --- Commands in a state -----------------------------------------------------
  {
    const m = input.match(
      /(?:what|which)?\s*commands?\s+(?:are\s+)?(?:available\s+)?(?:in|from|for)\s+"?([^"?]+?)"?\??\s*$/i,
    );
    if (m) {
      const hit = findStateAcrossWorkflows(ctx, unquote(m[1]!));
      if (!hit) {
        return { text: `I couldn’t find a state matching "${unquote(m[1]!)}". Ask "show my workflows" to see every state.` };
      }
      const graph = graphFor(ctx, hit.workflow.workflowId);
      const outgoing = graph?.transitions.filter((t) => t.fromStateId === hit.state.stateId) ?? [];
      const lines =
        graph == null
          ? 'Open the queue below to see its commands.'
          : outgoing.length === 0
            ? `"${hit.state.displayName}" is ${hit.state.final ? 'a final state — content rests here with no outgoing commands' : 'currently a dead end: no outgoing commands'}.`
            : `From "${hit.state.displayName}" editors can: ${outgoing
                .map((t) => {
                  const to = graph.states.find((s) => s.stateId === t.toStateId);
                  return `${t.displayName} (→ ${to?.displayName ?? 'stays'})`;
                })
                .join(', ')}.`;
      return {
        text: lines,
        embed: {
          kind: 'state-queue',
          workflowId: hit.workflow.workflowId,
          stateId: hit.state.stateId,
          stateName: hit.state.displayName,
          workflowName: hit.workflow.displayName,
        },
      };
    }
  }

  // --- Explain a workflow --------------------------------------------------------
  {
    const m = input.match(
      /(?:explain|describe|show|open|tell me about)\s+(?:me\s+)?(?:the\s+)?"?([^"]+?)"?\s*$/i,
    );
    if (m && !/workflows$/i.test(msg)) {
      const { workflow, ambiguous } = resolveWorkflow(ctx, unquote(m[1]!));
      if (ambiguous) {
        return {
          text: `Which one: ${ambiguous.map((w) => `"${w.displayName}"`).join(', ')}?`,
          conversation: { awaitingWorkflowIds: ambiguous.map((workflow) => workflow.workflowId) },
        };
      }
      if (workflow) {
        return explainWorkflow(workflow, ctx);
      }
    }
  }

  // --- List workflows -----------------------------------------------------------
  if (/workflows?/.test(msg) && /(show|list|see|what|my|all)/.test(msg)) {
    return {
      text:
        ctx.workflows.length === 0
          ? 'No workflows are defined yet. Say e.g. "create a workflow called Content Review" and I’ll draft one for you.'
          : `You have ${ctx.workflows.length} workflow${ctx.workflows.length === 1 ? '' : 's'}: ${ctx.workflows.map((w) => `"${w.displayName}" (${w.states.length} states)`).join(', ')}.`,
      embed: { kind: 'workflow-list' },
    };
  }

  return {
    text: 'I didn’t catch a workflow request in that. ' + CAPABILITIES_TEXT,
    embed: { kind: 'capabilities' },
  };
}

export const ASSISTANT_SUGGESTIONS = [
  'Show my workflows',
  'Create a workflow called Content Review',
  'Add a state called Legal Check to Sample Workflow',
  'What commands are available in Awaiting Approval?',
];
