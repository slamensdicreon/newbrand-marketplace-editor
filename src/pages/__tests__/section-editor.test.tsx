// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarketplaceProvider } from '@/lib/marketplace/provider';
import SectionEditor from '@/pages/section-editor';

/**
 * Editor-level integration tests for draft persistence. Rendered standalone
 * (not embedded), the provider selects the in-memory demo host with the real
 * New Brand seed content, so no network or Sitecore access is involved.
 */

const DRAFT_KEY = 'home-editor:draft:services';
const SEED_HEADING = 'WANT IT EVEN READIER?';

function renderEditor() {
  const { hook } = memoryLocation({ path: '/sections/services' });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplaceProvider>
        <Router hook={hook}>
          <Route path="/sections/:id" component={SectionEditor} />
        </Router>
      </MarketplaceProvider>
    </QueryClientProvider>,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until a condition holds; real-timer based to avoid act/waitFor stalls. */
async function until<T>(fn: () => T | null | false, what: string): Promise<T> {
  for (let i = 0; i < 150; i++) {
    const result = fn();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Wait until the editor has loaded content and initialized field state. */
async function findHeadingInput(expected: string): Promise<HTMLInputElement> {
  return until(() => {
    const el = screen.queryByTestId('input-heading') as HTMLInputElement | null;
    return el && el.value === expected ? el : null;
  }, `heading input with value "${expected}"`);
}

async function untilDraft(check: (raw: string | null) => boolean, what: string) {
  await until(
    () => (check(window.sessionStorage.getItem(DRAFT_KEY)) ? true : null),
    what,
  );
}

describe('section editor draft persistence', () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    // Force demo mode regardless of how the test runner frames the window.
    window.history.replaceState(null, '', '/?host=demo');
  });

  it('restores unsaved edits after unmount/remount (navigation escape)', async () => {
    const first = renderEditor();
    const input = await findHeadingInput(SEED_HEADING);

    fireEvent.change(input, { target: { value: 'DRAFT HEADING' } });
    await untilDraft((raw) => !!raw && raw.includes('DRAFT HEADING'), 'draft saved');

    // Simulate the router transitioning away despite the guard.
    first.unmount();

    const second = renderEditor();
    await findHeadingInput('DRAFT HEADING');
    second.unmount();
  });

  it('clears the draft on successful save and does not restore afterwards', async () => {
    const first = renderEditor();
    const input = await findHeadingInput(SEED_HEADING);
    fireEvent.change(input, { target: { value: 'SAVED HEADING' } });
    await untilDraft((raw) => raw !== null, 'draft saved');

    fireEvent.click(screen.getByTestId('button-save'));
    await untilDraft((raw) => raw === null, 'draft cleared after save');
    first.unmount();

    // A fresh provider creates a fresh demo host (seed content); with the
    // draft cleared by the save, nothing is restored over the host values.
    const second = renderEditor();
    await findHeadingInput(SEED_HEADING);
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    second.unmount();
  });

  it('removes the draft when edits return to the saved baseline', async () => {
    const view = renderEditor();
    const input = await findHeadingInput(SEED_HEADING);
    fireEvent.change(input, { target: { value: 'TEMP' } });
    await untilDraft((raw) => raw !== null, 'draft saved');
    fireEvent.change(input, { target: { value: SEED_HEADING } });
    await untilDraft((raw) => raw === null, 'draft cleared at baseline');
    view.unmount();
  });
});
