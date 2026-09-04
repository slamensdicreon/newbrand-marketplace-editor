import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/lib/assistant/engine';
import type { AssistantContext } from '@/lib/assistant/types';
import type { WorkflowGraph } from '@/lib/workflow/types';

const sampleGraph: WorkflowGraph = {
  workflowId: 'wf-1',
  states: [
    { stateId: 's-draft', displayName: 'Draft', initial: true, final: false },
    { stateId: 's-review', displayName: 'Awaiting Approval', initial: false, final: false },
    { stateId: 's-done', displayName: 'Approved', initial: false, final: true },
  ],
  transitions: [
    { commandId: 'c-submit', displayName: 'Submit', fromStateId: 's-draft', toStateId: 's-review' },
    { commandId: 'c-approve', displayName: 'Approve', fromStateId: 's-review', toStateId: 's-done' },
    { commandId: 'c-reject', displayName: 'Reject', fromStateId: 's-review', toStateId: 's-draft' },
  ],
};

const ctx: AssistantContext = {
  workflows: [
    {
      workflowId: 'wf-1',
      displayName: 'Sample Workflow',
      states: sampleGraph.states,
    },
  ],
  graphs: { 'wf-1': sampleGraph },
};

describe('assistant engine', () => {
  it('answers help without a proposal', () => {
    const r = parseMessage('help', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/confirm/i);
    expect(r.text).toMatch(/work inbox/i);
    expect(r.text).toMatch(/AI quality checks/i);
  });

  it.each([
    ['How should I use the work inbox?', /prioritized view/i],
    ['How do AI quality checks work?', /advisory only/i],
    ['How do I assign content to a workflow?', /editing page fields still happens/i],
    ['How do I work from Page builder?', /live workflow status/i],
  ])('explains current operations feature: %s', (prompt, expected) => {
    const reply = parseMessage(prompt, ctx);
    expect(reply.text).toMatch(expected);
    expect(reply.proposal).toBeUndefined();
  });

  it('lists workflows', () => {
    const r = parseMessage('show my workflows', ctx);
    expect(r.embed).toEqual({ kind: 'workflow-list' });
    expect(r.text).toContain('Sample Workflow');
  });

  it('drafts a create-workflow proposal with listed states', () => {
    const r = parseMessage(
      'create a workflow called Legal Review with states Draft, Legal Check, Approved',
      ctx,
    );
    expect(r.proposal?.kind).toBe('create-workflow');
    if (r.proposal?.kind !== 'create-workflow') throw new Error('expected proposal');
    expect(r.proposal.spec.name).toBe('Legal Review');
    expect(r.proposal.spec.states.map((s) => s.name)).toEqual([
      'Draft',
      'Legal Check',
      'Approved',
    ]);
    expect(r.proposal.spec.states[0]!.initial).toBe(true);
    expect(r.proposal.spec.states[2]!.final).toBe(true);
    // Transitions exist and only reference draft state keys.
    const keys = new Set(r.proposal.spec.states.map((s) => s.key));
    expect(r.proposal.spec.transitions.length).toBeGreaterThan(0);
    for (const t of r.proposal.spec.transitions) {
      expect(keys.has(t.fromKey)).toBe(true);
      expect(keys.has(t.toKey)).toBe(true);
    }
  });

  it('refuses duplicate workflow names', () => {
    const r = parseMessage('create a workflow called Sample Workflow', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/already exists/i);
  });

  it('proposes add-state against the resolved workflow (never an invented id)', () => {
    const r = parseMessage('add a final state called Archived to Sample Workflow', ctx);
    expect(r.proposal).toEqual({
      kind: 'add-state',
      workflowId: 'wf-1',
      workflowName: 'Sample Workflow',
      stateName: 'Archived',
      final: true,
    });
  });

  it('rejects add-state for an existing state name', () => {
    const r = parseMessage('add a state called Draft to Sample Workflow', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/already has a state/i);
  });

  it('proposes add-transition with real state ids resolved by name', () => {
    const r = parseMessage(
      'add a transition called Escalate from Draft to Approved in Sample Workflow',
      ctx,
    );
    expect(r.proposal).toMatchObject({
      kind: 'add-transition',
      workflowId: 'wf-1',
      fromStateId: 's-draft',
      toStateId: 's-done',
      commandName: 'Escalate',
    });
  });

  it('refuses transitions to unknown states instead of guessing', () => {
    const r = parseMessage(
      'add a transition called Jump from Draft to Nirvana in Sample Workflow',
      ctx,
    );
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/no state named "Nirvana"/i);
  });

  it('resolves delete-transition to the REAL command id from the loaded graph', () => {
    const r = parseMessage('delete the Reject transition in Sample Workflow', ctx);
    expect(r.proposal).toMatchObject({
      kind: 'delete-transition',
      commandId: 'c-reject',
      workflowId: 'wf-1',
    });
  });

  it('never proposes deletion when the graph is not loaded', () => {
    const r = parseMessage('delete the Reject transition in Sample Workflow', {
      ...ctx,
      graphs: {},
    });
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/haven’t loaded/i);
  });

  it('refuses to delete when multiple transitions share a name', () => {
    const dupGraph: WorkflowGraph = {
      ...sampleGraph,
      transitions: [
        ...sampleGraph.transitions,
        { commandId: 'c-reject2', displayName: 'Reject', fromStateId: 's-done', toStateId: 's-draft' },
      ],
    };
    const r = parseMessage('delete the Reject transition in Sample Workflow', {
      ...ctx,
      graphs: { 'wf-1': dupGraph },
    });
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/2 transitions named/i);
  });

  it('explains commands available from a state using only real transitions', () => {
    const r = parseMessage('what commands are available in Awaiting Approval?', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toContain('Approve');
    expect(r.text).toContain('Reject');
    expect(r.embed).toMatchObject({ kind: 'state-queue', stateId: 's-review' });
  });

  it('teaches the user what state roles are available', () => {
    const r = parseMessage('what kind of states can I create?', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/initial state/i);
    expect(r.text).toMatch(/working\/review states/i);
    expect(r.text).toMatch(/final states/i);
  });

  it('explains how a three-state review flow works', () => {
    const r = parseMessage('3 states', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toContain('Draft → In Review → Approved');
    expect(r.text).toMatch(/Reject transition/i);
  });

  it('understands a workflow name as the answer to an ambiguity prompt', () => {
    const webhook = {
      workflowId: 'wf-webhook',
      displayName: 'Sample Webhook Workflow',
      states: sampleGraph.states,
    };
    const multiWorkflowCtx: AssistantContext = {
      workflows: [...ctx.workflows, webhook],
      graphs: { ...ctx.graphs, [webhook.workflowId]: { ...sampleGraph, workflowId: webhook.workflowId } },
    };
    const prompt = parseMessage('explain the Sample', multiWorkflowCtx);
    expect(prompt.conversation?.awaitingWorkflowIds).toEqual(
      expect.arrayContaining(['wf-1', 'wf-webhook']),
    );

    const selected = parseMessage('Sample Webhook Workflow', multiWorkflowCtx, prompt.conversation);
    expect(selected.text).toContain('"Sample Webhook Workflow" has 3 states');
    expect(selected.embed).toEqual({ kind: 'workflow-overview', workflowId: 'wf-webhook' });
    expect(selected.conversation).toEqual({ selectedWorkflowId: 'wf-webhook' });
  });

  it('uses the selected workflow for a concise follow-up change request', () => {
    const selected = parseMessage('Sample Workflow', ctx);
    const r = parseMessage('add a state called Legal Check', ctx, selected.conversation);
    expect(r.proposal).toMatchObject({
      kind: 'add-state',
      workflowId: 'wf-1',
      workflowName: 'Sample Workflow',
      stateName: 'Legal Check',
    });
  });

  it('does not mistake a mutation for a workflow choice while awaiting selection', () => {
    const webhook = {
      workflowId: 'wf-webhook',
      displayName: 'Sample Webhook Workflow',
      states: sampleGraph.states,
    };
    const multiWorkflowCtx: AssistantContext = {
      workflows: [...ctx.workflows, webhook],
      graphs: ctx.graphs,
    };
    const r = parseMessage(
      'add a state called Legal Check to Sample Workflow',
      multiWorkflowCtx,
      { awaitingWorkflowIds: ['wf-1', 'wf-webhook'] },
    );
    expect(r.proposal).toMatchObject({
      kind: 'add-state',
      workflowId: 'wf-1',
      stateName: 'Legal Check',
    });
  });

  it('fails closed when a previously selected workflow is no longer in host data', () => {
    const r = parseMessage('add a state called Legal Check', { workflows: [], graphs: {} }, {
      selectedWorkflowId: 'wf-1',
    });
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/which workflow/i);
  });

  it('explains the selected workflow when the user says explain it', () => {
    const selected = parseMessage('Sample Workflow', ctx);
    const r = parseMessage('explain it', ctx, selected.conversation);
    expect(r.text).toContain('"Sample Workflow" has 3 states');
    expect(r.conversation).toEqual({ selectedWorkflowId: 'wf-1' });
  });

  it('never falls back to the only workflow when an explicit name does not resolve', () => {
    const r = parseMessage('delete the Reject transition in Other Workflow', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/couldn’t find a workflow named "Other/i);
  });

  it('refuses add-state to an unknown workflow name', () => {
    const r = parseMessage('add a state called Archived to Ghost Workflow', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/couldn’t find a workflow named "Ghost/i);
  });

  it('refuses add-transition when the explicit workflow name does not resolve', () => {
    const r = parseMessage('add a transition called Jump from Draft to Approved in Ghost Workflow', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/couldn’t find a workflow named "Ghost/i);
  });

  it('reports ambiguous partial state names instead of picking one', () => {
    const ambCtx: AssistantContext = {
      workflows: [
        {
          workflowId: 'wf-1',
          displayName: 'Sample Workflow',
          states: [
            { stateId: 's-1', displayName: 'Review Legal', initial: true, final: false },
            { stateId: 's-2', displayName: 'Review Editorial', initial: false, final: false },
            { stateId: 's-3', displayName: 'Approved', initial: false, final: true },
          ],
        },
      ],
      graphs: {},
    };
    const r = parseMessage(
      'add a transition called Go from Review to Approved in Sample Workflow',
      ambCtx,
    );
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/several states match/i);
  });

  it('falls back to capabilities for unrelated input', () => {
    const r = parseMessage('what is the weather like', ctx);
    expect(r.proposal).toBeUndefined();
    expect(r.embed).toEqual({ kind: 'capabilities' });
  });
});
