import { describe, expect, it } from 'vitest';
import { getSection } from '@/lib/home-content';
import { MockMarketplaceHost } from '@/lib/marketplace/mock-host';

const fast = () => new MockMarketplaceHost({ latencyMs: 0 });

describe('MockMarketplaceHost', () => {
  it('reports demo mode and a demo site', async () => {
    const host = fast();
    expect(host.mode).toBe('demo');
    const site = await host.getSite();
    expect(site.siteName).toBe('New Brand');
    expect(site.environment).toContain('Demo');
  });

  it('loads seeded content for every defined section', async () => {
    const host = fast();
    const section = getSection('quote')!;
    const values = await host.loadSection(section);
    expect(values['title']).toContain('READY');
  });

  it('persists saves within the instance but never across instances', async () => {
    const section = getSection('services')!;
    const a = fast();
    await a.saveSection(section, { heading: 'CHANGED' });
    expect((await a.loadSection(section))['heading']).toBe('CHANGED');

    const b = fast();
    expect((await b.loadSection(section))['heading']).toBe('WANT IT EVEN READIER?');
  });

  it('returns copies so callers cannot mutate the store', async () => {
    const host = fast();
    const section = getSection('services')!;
    const values = await host.loadSection(section);
    values['heading'] = 'MUTATED';
    expect((await host.loadSection(section))['heading']).not.toBe('MUTATED');
  });

  it('rejects saves for fields not defined on the section', async () => {
    const host = fast();
    const section = getSection('services')!;
    await expect(host.saveSection(section, { hacked: 'x' })).rejects.toThrow(/not editable/);
  });

  it('rejects unknown sections', async () => {
    const host = fast();
    const bogus = { ...getSection('services')!, id: 'nope' };
    await expect(host.loadSection(bogus)).rejects.toThrow(/Unknown section/);
  });
});
