import { describe, expect, it } from 'vitest';
import {
  detectEmbeddingOrigin,
  isEmbedded,
  resolveAllowedHostOrigin,
} from '@/lib/marketplace/host';

describe('resolveAllowedHostOrigin', () => {
  it('accepts Sitecore cloud origins', () => {
    expect(resolveAllowedHostOrigin('https://portal.sitecorecloud.io/some/page')).toBe(
      'https://portal.sitecorecloud.io',
    );
    expect(resolveAllowedHostOrigin('https://xmapps.sitecore.io/')).toBe(
      'https://xmapps.sitecore.io',
    );
    expect(resolveAllowedHostOrigin('https://ai.sitecore.com/org/apps')).toBe(
      'https://ai.sitecore.com',
    );
  });

  it('accepts the SDK-trusted SitecoreAI host domains', () => {
    expect(resolveAllowedHostOrigin('https://portal.sitecorecloud.app/apps')).toBe(
      'https://portal.sitecorecloud.app',
    );
    expect(resolveAllowedHostOrigin('https://sitecorecloud.app')).toBe(
      'https://sitecorecloud.app',
    );
    expect(resolveAllowedHostOrigin('https://xm.sitecore-staging.cloud/')).toBe(
      'https://xm.sitecore-staging.cloud',
    );
  });

  it('rejects non-Sitecore origins', () => {
    expect(resolveAllowedHostOrigin('https://evil.example.com/')).toBeNull();
    expect(resolveAllowedHostOrigin('https://sitecorecloud.io.attacker.net/')).toBeNull();
    expect(resolveAllowedHostOrigin('https://notsitecore.com/')).toBeNull();
    expect(resolveAllowedHostOrigin('https://evilsitecorecloud.app/')).toBeNull();
    expect(resolveAllowedHostOrigin('https://sitecorecloud.app.attacker.net/')).toBeNull();
  });

  it('rejects insecure http origins', () => {
    expect(resolveAllowedHostOrigin('http://portal.sitecorecloud.io/')).toBeNull();
  });

  it('rejects empty or malformed referrers', () => {
    expect(resolveAllowedHostOrigin('')).toBeNull();
    expect(resolveAllowedHostOrigin('not a url')).toBeNull();
  });
});

describe('detectEmbeddingOrigin', () => {
  const loc = (origins: string[]) =>
    ({ ancestorOrigins: origins as unknown as DOMStringList }) as Pick<
      Location,
      'ancestorOrigins'
    >;

  it('prefers ancestorOrigins when available', () => {
    expect(
      detectEmbeddingOrigin(loc(['https://portal.sitecorecloud.app']), 'https://other.example.com/'),
    ).toBe('https://portal.sitecorecloud.app');
  });

  it('uses the immediate parent (index 0) in nested embeddings, per spec ordering', () => {
    // HTML spec: ancestorOrigins[0] is the nearest ancestor (immediate
    // parent), the last entry is the top-level frame. window.parent — the
    // handshake target — corresponds to index 0.
    expect(
      detectEmbeddingOrigin(
        loc(['https://xmapps.sitecorecloud.io', 'https://portal.sitecorecloud.app']),
        '',
      ),
    ).toBe('https://xmapps.sitecorecloud.io');
  });

  it('falls back to referrer when ancestorOrigins is missing or empty', () => {
    expect(
      detectEmbeddingOrigin(loc([]), 'https://portal.sitecorecloud.io/some/page'),
    ).toBe('https://portal.sitecorecloud.io');
    expect(
      detectEmbeddingOrigin(
        { ancestorOrigins: undefined } as unknown as Pick<Location, 'ancestorOrigins'>,
        'https://portal.sitecorecloud.io/',
      ),
    ).toBe('https://portal.sitecorecloud.io');
  });

  it('ignores an opaque "null" ancestor origin', () => {
    expect(detectEmbeddingOrigin(loc(['null']), 'https://portal.sitecorecloud.io/')).toBe(
      'https://portal.sitecorecloud.io',
    );
  });

  it('returns null when nothing is detectable', () => {
    expect(detectEmbeddingOrigin(loc([]), '')).toBeNull();
    expect(detectEmbeddingOrigin(loc([]), 'not a url')).toBeNull();
  });
});

describe('isEmbedded', () => {
  it('is false when self === top', () => {
    const w = {} as Window;
    expect(isEmbedded({ self: w, top: w })).toBe(false);
  });

  it('is true when self !== top', () => {
    expect(isEmbedded({ self: {} as Window, top: {} as Window })).toBe(true);
  });

  it('is true when accessing top throws (cross-origin)', () => {
    const win = {
      self: {} as Window,
      get top(): Window {
        throw new Error('cross-origin');
      },
    };
    expect(isEmbedded(win)).toBe(true);
  });
});
