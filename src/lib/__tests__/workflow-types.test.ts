import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  formatAge,
  normalizeId,
  parseSitecoreDate,
  validateDraftWorkflow,
  type DraftWorkflowSpec,
} from '@/lib/workflow/types';

function validSpec(): DraftWorkflowSpec {
  return {
    name: 'Review Flow',
    states: [
      { key: 'a', name: 'Draft', initial: true, final: false },
      { key: 'b', name: 'Approved', initial: false, final: true },
    ],
    transitions: [{ name: 'Submit', fromKey: 'a', toKey: 'b' }],
  };
}

describe('validateDraftWorkflow', () => {
  it('accepts a minimal valid flow', () => {
    expect(validateDraftWorkflow(validSpec())).toEqual([]);
  });

  it('requires a workflow name', () => {
    const spec = { ...validSpec(), name: '  ' };
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/name/i);
  });

  it('rejects invalid item-name characters', () => {
    const spec = { ...validSpec(), name: 'Bad/Name' };
    expect(validateDraftWorkflow(spec).length).toBeGreaterThan(0);
  });

  it('requires at least two states', () => {
    const spec = validSpec();
    spec.states = [spec.states[0]!];
    spec.transitions = [];
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/two states/i);
  });

  it('requires unique state names (case-insensitive)', () => {
    const spec = validSpec();
    spec.states[1] = { ...spec.states[1]!, name: 'draft' };
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/unique/i);
  });

  it('requires exactly one initial state', () => {
    const spec = validSpec();
    spec.states[1] = { ...spec.states[1]!, initial: true };
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/initial state/i);
  });

  it('rejects an initial+final state', () => {
    const spec = validSpec();
    spec.states[0] = { ...spec.states[0]!, final: true };
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/initial state cannot/i);
  });

  it('rejects dangling transitions', () => {
    const spec = validSpec();
    spec.transitions = [{ name: 'Submit', fromKey: 'a', toKey: 'missing' }];
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/no longer exists/i);
  });

  it('rejects self-transitions', () => {
    const spec = validSpec();
    spec.transitions = [{ name: 'Loop', fromKey: 'a', toKey: 'a' }];
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/different state/i);
  });

  it('requires at least one transition', () => {
    const spec = validSpec();
    spec.transitions = [];
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/one transition/i);
  });

  it('rejects duplicate command names on one state', () => {
    const spec = validSpec();
    spec.states.push({ key: 'c', name: 'Rejected', initial: false, final: false });
    spec.transitions = [
      { name: 'Submit', fromKey: 'a', toKey: 'b' },
      { name: 'submit', fromKey: 'a', toKey: 'c' },
    ];
    expect(validateDraftWorkflow(spec).join(' ')).toMatch(/unique per state/i);
  });
});

describe('normalizeId', () => {
  it('normalizes bare hex to braced-uppercase', () => {
    expect(normalizeId('a5bc37e7ed964c1e8590a26e64db55ea')).toBe(
      '{A5BC37E7-ED96-4C1E-8590-A26E64DB55EA}',
    );
  });

  it('is idempotent for braced ids', () => {
    const id = '{A5BC37E7-ED96-4C1E-8590-A26E64DB55EA}';
    expect(normalizeId(id)).toBe(id);
  });
});

describe('parseSitecoreDate', () => {
  it('parses compact Sitecore ISO dates', () => {
    expect(parseSitecoreDate('20221128T074116Z')).toBe('2022-11-28T07:41:16.000Z');
  });

  it('returns null for empty/garbage values', () => {
    expect(parseSitecoreDate('')).toBeNull();
    expect(parseSitecoreDate('not-a-date')).toBeNull();
    expect(parseSitecoreDate(undefined)).toBeNull();
  });
});

describe('ageBucket / formatAge', () => {
  const now = new Date('2026-08-23T12:00:00Z');

  it('buckets by the visible thresholds', () => {
    expect(ageBucket('2026-08-23T06:00:00Z', now)).toBe('fresh');
    expect(ageBucket('2026-08-20T12:00:00Z', now)).toBe('aging');
    expect(ageBucket('2026-08-10T12:00:00Z', now)).toBe('stale');
    expect(ageBucket(null, now)).toBe('unknown');
  });

  it('formats compact ages', () => {
    expect(formatAge('2026-08-23T11:30:00Z', now)).toBe('30m');
    expect(formatAge('2026-08-22T12:00:00Z', now)).toBe('24h');
    expect(formatAge('2026-08-13T12:00:00Z', now)).toBe('10d');
    expect(formatAge(null, now)).toBe('unknown age');
  });
});
