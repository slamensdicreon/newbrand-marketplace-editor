// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BrandReviewResult } from '@/lib/workflow/brand-review';

// The real hooks (with their host-generation guards and validation) run
// against a stubbed demo host injected through the mock-host module.
const mocks = vi.hoisted(() => ({
  host: {
    mode: 'demo',
    getBrandReviewSupport: vi.fn(),
    getItemReviewContent: vi.fn(),
    generateBrandReview: vi.fn(),
    executeCommand: vi.fn(),
    subscribePageContext: () => () => undefined,
    subscribeContentUpdates: () => () => undefined,
    destroy: () => undefined,
  },
}));

vi.mock('@/lib/marketplace/mock-host', () => ({
  MockMarketplaceHost: class {
    constructor() {
      return mocks.host;
    }
  },
}));

import { MarketplaceProvider } from '@/lib/marketplace/provider';
import { BrandReviewPanel, BrandReviewConfirmSummary } from '@/components/brand-review';

function renderPanel(props?: Partial<Parameters<typeof BrandReviewPanel>[0]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const state: { review: BrandReviewResult | null } = { review: null };
  function Wrapper() {
    return (
      <QueryClientProvider client={client}>
        <MarketplaceProvider>
          <BrandReviewPanel
            itemId="{ITEM-1}"
            language="en"
            itemUpdatedAt="2026-08-01T00:00:00Z"
            review={state.review}
            onReview={(r) => {
              state.review = r;
            }}
            {...props}
          />
        </MarketplaceProvider>
      </QueryClientProvider>
    );
  }
  const utils = render(<Wrapper />);
  return { ...utils, state, rerenderPanel: () => utils.rerender(<Wrapper />) };
}

const sampleSections = [
  { sectionId: 'voice-and-tone', score: 4, reason: 'Good.', suggestion: 'Keep it.', fields: [] },
];

const sampleContent = {
  itemId: '{ITEM-1}',
  language: 'en',
  version: 1,
  updatedAt: '2026-08-01T00:00:00Z',
  entries: [{ source: 'field' as const, label: 'Title', text: 'Hello' }],
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host.getBrandReviewSupport.mockResolvedValue({
    available: true,
    brandKitId: 'kit-1',
    message: null,
  });
  mocks.host.getItemReviewContent.mockResolvedValue(sampleContent);
  mocks.host.generateBrandReview.mockResolvedValue(sampleSections);
});

afterEach(() => cleanup());

describe('BrandReviewPanel', () => {
  it('shows an unavailable message when no brand kit is connected', async () => {
    mocks.host.getBrandReviewSupport.mockResolvedValue({
      available: false,
      brandKitId: null,
      message: 'No brand kit is connected.',
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('text-brand-review-unavailable')).toBeTruthy(),
    );
    expect(screen.getByTestId('text-brand-review-unavailable').textContent).toContain(
      'No brand kit is connected.',
    );
  });

  it('runs a review and shows results with a demo label — never touching commands', async () => {
    const { state, rerenderPanel } = renderPanel();
    await waitFor(() => screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    fireEvent.click(screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    await waitFor(() => expect(state.review).not.toBeNull());
    rerenderPanel();
    expect(screen.getByTestId('results-brand-review')).toBeTruthy();
    expect(screen.getByTestId('badge-review-demo')).toBeTruthy();
    expect(screen.getByTestId('badge-section-score-voice-and-tone').textContent).toContain('4/5');
    // The critical separation: AI analysis must never execute workflow commands.
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
    expect(state.review!.demo).toBe(true);
    expect(state.review!.contentUpdatedAt).toBe('2026-08-01T00:00:00Z');
  });

  it('shows a low-score warning without blocking anything', async () => {
    mocks.host.generateBrandReview.mockResolvedValue([
      { sectionId: 'terminology', score: 1, reason: 'Off-brand.', suggestion: 'Fix.', fields: [] },
    ]);
    const { state, rerenderPanel } = renderPanel();
    await waitFor(() => screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    fireEvent.click(screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    await waitFor(() => expect(state.review).not.toBeNull());
    rerenderPanel();
    expect(screen.getByTestId('alert-review-low-score')).toBeTruthy();
    expect(mocks.host.executeCommand).not.toHaveBeenCalled();
  });

  it('marks a review stale when the item changed after it was generated', async () => {
    const { state, rerenderPanel } = renderPanel({ itemUpdatedAt: '2026-08-05T00:00:00Z' });
    await waitFor(() => screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    fireEvent.click(screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    await waitFor(() => expect(state.review).not.toBeNull());
    rerenderPanel();
    // Content was gathered at 08-01 but the item now reports 08-05.
    expect(screen.getByTestId('badge-review-stale')).toBeTruthy();
  });

  it('surfaces analysis errors', async () => {
    mocks.host.generateBrandReview.mockRejectedValue(new Error('Skill quota exceeded.'));
    renderPanel();
    await waitFor(() => screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    fireEvent.click(screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    await waitFor(() => screen.getByTestId('text-brand-review-error'));
    expect(screen.getByTestId('text-brand-review-error').textContent).toContain(
      'Skill quota exceeded.',
    );
  });

  it('refuses items without reviewable text', async () => {
    mocks.host.getItemReviewContent.mockResolvedValue({ ...sampleContent, entries: [] });
    renderPanel();
    await waitFor(() => screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    fireEvent.click(screen.getByTestId('button-run-brand-review-{ITEM-1}'));
    await waitFor(() => screen.getByTestId('text-brand-review-error'));
    expect(screen.getByTestId('text-brand-review-error').textContent).toContain(
      'no reviewable text',
    );
    expect(mocks.host.generateBrandReview).not.toHaveBeenCalled();
  });
});

describe('BrandReviewConfirmSummary', () => {
  const review: BrandReviewResult = {
    generatedAt: '2026-08-01T12:00:00Z',
    fingerprint: 'fp1',
    contentUpdatedAt: '2026-08-01T00:00:00Z',
    demo: true,
    truncated: false,
    sections: sampleSections,
  };

  it('tells the reviewer when no check has been run', () => {
    render(<BrandReviewConfirmSummary review={null} itemUpdatedAt={null} />);
    expect(screen.getByTestId('text-confirm-no-review')).toBeTruthy();
  });

  it('summarizes score, timestamp, demo label, and staleness', () => {
    render(
      <BrandReviewConfirmSummary review={review} itemUpdatedAt="2026-08-02T00:00:00Z" />,
    );
    const text = screen.getByTestId('text-confirm-review-summary').textContent!;
    expect(text).toContain('score 4/5');
    expect(text).toContain('demo sample');
    expect(text).toContain('content changed since this review');
  });

  it('warns on low scores without disabling anything', () => {
    render(
      <BrandReviewConfirmSummary
        review={{
          ...review,
          sections: [{ sectionId: 'a', score: 1, reason: '', suggestion: '', fields: [] }],
        }}
        itemUpdatedAt="2026-08-01T00:00:00Z"
      />,
    );
    expect(screen.getByTestId('text-confirm-review-summary').textContent).toContain(
      'Low brand score',
    );
  });
});
