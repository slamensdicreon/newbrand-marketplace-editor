// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();

vi.mock('@sitecore-marketplace-sdk/client', () => ({
  ClientSDK: { init: (...args: unknown[]) => initMock(...args) },
}));
vi.mock('@sitecore-marketplace-sdk/xmc', () => ({ XMC: {} }));

const hostMocks = vi.hoisted(() => ({
  isEmbedded: vi.fn(),
  detectEmbeddingOrigin: vi.fn(),
}));

vi.mock('@/lib/marketplace/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/marketplace/host')>();
  return {
    ...actual,
    isEmbedded: hostMocks.isEmbedded,
    detectEmbeddingOrigin: hostMocks.detectEmbeddingOrigin,
  };
});

import { HostUnavailableError } from '@/lib/marketplace/host';
import { SdkMarketplaceHost } from '@/lib/marketplace/sdk-host';

function connectedClient(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockImplementation((operation: string) => {
      if (operation === 'application.context') {
        return Promise.resolve({
          data: {
            resourceAccess: [
              {
                resourceId: 'new-brand-environment',
                context: {
                  live: 'live-context-id',
                  preview: 'preview-context-id',
                },
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    }),
    mutate: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('SdkMarketplaceHost.connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostMocks.isEmbedded.mockReturnValue(true);
  });

  it('fails closed without messaging when not embedded', async () => {
    hostMocks.isEmbedded.mockReturnValue(false);
    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(HostUnavailableError);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('fails closed without messaging when the embedding origin is undetectable', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue(null);
    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(/could not be verified/);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('fails closed without messaging for an untrusted embedding origin', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('https://evil.example.com');
    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(
      /https:\/\/evil\.example\.com.*not an approved Sitecore host/,
    );
    expect(initMock).not.toHaveBeenCalled();
  });

  it('fails closed without messaging for an http Sitecore-lookalike origin', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('http://portal.sitecorecloud.io');
    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(HostUnavailableError);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('pins the handshake to the exact trusted origin', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('https://portal.sitecorecloud.app');
    initMock.mockResolvedValue(connectedClient());
    await SdkMarketplaceHost.connect();
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      origin: 'https://portal.sitecorecloud.app',
    });
  });

  it('maps handshake timeouts to a distinct actionable error', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('https://portal.sitecorecloud.io');
    initMock.mockRejectedValue(new Error('Handshake timed out after 8000 ms'));
    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(/did not answer.*handshake in time/);
  });

  it('requires SitecoreAI API resource access in the Marketplace app context', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('https://portal.sitecorecloud.app');
    const client = connectedClient({
      query: vi.fn().mockResolvedValue({ data: { resourceAccess: [] } }),
    });
    initMock.mockResolvedValue(client);

    await expect(SdkMarketplaceHost.connect()).rejects.toThrow(
      /no SitecoreAI API resource access/,
    );
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('passes the live Sitecore Context ID with Authoring GraphQL requests', async () => {
    hostMocks.detectEmbeddingOrigin.mockReturnValue('https://portal.sitecorecloud.app');
    const mutate = vi.fn().mockResolvedValue({
      data: {
        data: {
          workflows: { nodes: [] },
        },
      },
    });
    initMock.mockResolvedValue(connectedClient({ mutate }));
    const host = await SdkMarketplaceHost.connect();

    await host.listWorkflows();

    expect(mutate).toHaveBeenCalledWith(
      'xmc.authoring.graphql',
      expect.objectContaining({
        params: expect.objectContaining({
          query: { sitecoreContextId: 'live-context-id' },
        }),
      }),
    );
  });
});
