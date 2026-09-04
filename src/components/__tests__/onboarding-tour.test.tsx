// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

/**
 * Two independent onboarding tutorials: the general WorkFLO tour and the
 * Builder tutorial. Covers first-visit triggers, independent completion
 * storage, replay from the "How It Works" navigation, and the Builder
 * guide's instructional sequence.
 */

vi.mock('@/lib/marketplace/provider', () => ({
  useEditorUser: () => ({ data: null }),
  useWorkflows: () => ({ data: [], isLoading: false }),
  useMarketplace: () => ({ status: { state: 'demo', reason: 'standalone' }, retry: vi.fn() }),
}));
vi.mock('@/components/assistant/chat-panel', () => ({
  ChatPanel: () => <div data-testid="mock-chat" />,
}));

import {
  BUILDER_ONBOARDING_STORAGE_KEY,
  BUILDER_TOUR,
  ONBOARDING_STORAGE_KEY,
  OnboardingTour,
  WORKFLO_TOUR,
} from '@/components/onboarding-tour';
import { WorkspaceShell } from '@/components/workspace-shell';

function renderShell(path = '/') {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <WorkspaceShell>
        <div data-testid="page" />
      </WorkspaceShell>
    </Router>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('OnboardingTour (generic component)', () => {
  it('advances through steps and records completion under the tour storage key', () => {
    const onOpenChange = vi.fn();
    render(<OnboardingTour tour={WORKFLO_TOUR} open onOpenChange={onOpenChange} />);
    expect(screen.getByText('1 of 5')).toBeTruthy();
    for (let i = 0; i < WORKFLO_TOUR.steps.length - 1; i++) {
      fireEvent.click(screen.getByTestId('button-tour-next'));
    }
    fireEvent.click(screen.getByText(WORKFLO_TOUR.finishLabel));
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('complete');
    expect(window.localStorage.getItem(BUILDER_ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape dismisses and counts as completion so it never auto-reopens', () => {
    const onOpenChange = vi.fn();
    render(<OnboardingTour tour={BUILDER_TOUR} open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(window.localStorage.getItem(BUILDER_ONBOARDING_STORAGE_KEY)).toBe('complete');
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
  });

  it('replaying always restarts at the first step', () => {
    const { rerender } = render(
      <OnboardingTour tour={BUILDER_TOUR} open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('button-tour-next'));
    expect(screen.getByText(`2 of ${BUILDER_TOUR.steps.length}`)).toBeTruthy();
    rerender(<OnboardingTour tour={BUILDER_TOUR} open={false} onOpenChange={() => {}} />);
    rerender(<OnboardingTour tour={BUILDER_TOUR} open onOpenChange={() => {}} />);
    expect(screen.getByText(`1 of ${BUILDER_TOUR.steps.length}`)).toBeTruthy();
  });
});

describe('Builder tutorial content', () => {
  it('teaches the real journey: name, states, transitions, validate, create, apply, publishable final state', () => {
    const titles = BUILDER_TOUR.steps.map((s) => s.title.toLowerCase());
    expect(titles[0]).toContain('name');
    expect(titles.some((t) => t.includes('state'))).toBe(true);
    expect(titles.some((t) => t.includes('transition'))).toBe(true);
    expect(BUILDER_TOUR.steps.some((s) => s.eyebrow.toLowerCase().includes('validate'))).toBe(true);
    expect(titles.some((t) => t.includes('create the workflow in sitecore'))).toBe(true);
    expect(titles.some((t) => t.includes('apply the workflow to a page'))).toBe(true);
    expect(titles.at(-1)).toContain('final state');
  });

  it('never claims a separate workflow-definition publish action exists', () => {
    const text = BUILDER_TOUR.steps
      .map((s) => `${s.title} ${s.description} ${s.hint}`)
      .join(' ')
      .toLowerCase();
    expect(text).toContain('no separate publish step for the definition');
    expect(text).not.toContain('publish the workflow definition');
    expect(text).not.toContain('publish your workflow');
  });
});

describe('WorkspaceShell tutorial triggers', () => {
  it('opens the general tour on a first visit anywhere', () => {
    renderShell('/');
    expect(screen.getByTestId('onboarding-tour')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-tour-builder')).toBeNull();
  });

  it('opens the Builder tutorial on a first Builder visit even after the general tour is done', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    renderShell('/builder');
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
    expect(screen.getByTestId('onboarding-tour-builder')).toBeTruthy();
  });

  it('does not stack the Builder tutorial on top of the general first-visit tour', () => {
    renderShell('/builder');
    expect(screen.getByTestId('onboarding-tour')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-tour-builder')).toBeNull();
    // Closing the general tour reveals the Builder tutorial.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
    expect(screen.getByTestId('onboarding-tour-builder')).toBeTruthy();
  });

  it('does not reopen a completed Builder tutorial on later Builder visits', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    window.localStorage.setItem(BUILDER_ONBOARDING_STORAGE_KEY, 'complete');
    renderShell('/builder');
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
    expect(screen.queryByTestId('onboarding-tour-builder')).toBeNull();
  });

  it('completing one tutorial never erases the other completion record', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    renderShell('/builder');
    fireEvent.keyDown(window, { key: 'Escape' }); // finish builder tutorial
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('complete');
    expect(window.localStorage.getItem(BUILDER_ONBOARDING_STORAGE_KEY)).toBe('complete');
  });

  it('replays either tutorial from the How It Works navigation', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    window.localStorage.setItem(BUILDER_ONBOARDING_STORAGE_KEY, 'complete');
    renderShell('/');
    fireEvent.click(screen.getByTestId('button-open-workflo-tour'));
    expect(screen.getByTestId('onboarding-tour')).toBeTruthy();
    expect(screen.getByText('1 of 5')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('button-open-builder-tour'));
    expect(screen.getByTestId('onboarding-tour-builder')).toBeTruthy();
    expect(screen.getByText(`1 of ${BUILDER_TOUR.steps.length}`)).toBeTruthy();
  });

  it('exposes mobile entry points for both tutorials', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    window.localStorage.setItem(BUILDER_ONBOARDING_STORAGE_KEY, 'complete');
    renderShell('/');
    fireEvent.click(screen.getByTestId('button-open-builder-tour-mobile'));
    expect(screen.getByTestId('onboarding-tour-builder')).toBeTruthy();
  });
});
