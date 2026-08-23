import { describe, expect, it } from 'vitest';
import {
  SECTION_DEFINITIONS,
  getSection,
  isSectionDirty,
  validateSection,
} from '@/lib/home-content';

describe('section definitions', () => {
  it('have unique ids and Sitecore item paths', () => {
    const ids = SECTION_DEFINITIONS.map((s) => s.id);
    const paths = SECTION_DEFINITIONS.map((s) => s.itemPath);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('all item paths live under the New Brand Data folder', () => {
    for (const s of SECTION_DEFINITIONS) {
      expect(s.itemPath.startsWith('/sitecore/content/brands/new-brand/Data/')).toBe(true);
    }
  });
});

describe('validateSection', () => {
  const section = getSection('services')!;

  it('accepts valid values', () => {
    expect(
      validateSection(section, {
        heading: 'WANT IT EVEN READIER?',
        note: 'Every service starts the same way.',
        linkLabel: 'START',
        linkHref: '#ready-plan',
      }),
    ).toEqual([]);
  });

  it('rejects empty required fields', () => {
    const errors = validateSection(section, { heading: '   ' });
    expect(errors.some((e) => e.fieldKey === 'heading')).toBe(true);
  });

  it('rejects values over maxLength', () => {
    const errors = validateSection(section, {
      heading: 'x'.repeat(61),
    });
    expect(errors.some((e) => e.fieldKey === 'heading')).toBe(true);
  });

  it('rejects malformed link targets', () => {
    const errors = validateSection(section, {
      heading: 'ok',
      linkHref: 'javascript:alert(1)',
    });
    expect(errors.some((e) => e.fieldKey === 'linkHref')).toBe(true);
  });

  it('allows anchors, absolute paths, and https links', () => {
    for (const href of ['#a', '/products', 'https://example.com']) {
      expect(validateSection(section, { heading: 'ok', linkHref: href })).toEqual([]);
    }
  });
});

describe('isSectionDirty', () => {
  const section = getSection('services')!;

  it('detects changed fields and ignores unknown keys', () => {
    const base = { heading: 'A', note: 'B' };
    expect(isSectionDirty(section, base, { heading: 'A', note: 'B' })).toBe(false);
    expect(isSectionDirty(section, base, { heading: 'A2', note: 'B' })).toBe(true);
    expect(isSectionDirty(section, base, { ...base, unrelated: 'x' } as never)).toBe(false);
  });
});
