import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  CloudUpload,
  FileCheck2,
  GitBranch,
  Inbox,
  ListChecks,
  PencilRuler,
  Sparkles,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkFLOLogo } from '@/components/workflo-brand';

export const ONBOARDING_STORAGE_KEY = 'workflo:onboarding:v1';
export const BUILDER_ONBOARDING_STORAGE_KEY = 'workflo:onboarding:builder:v1';

/** Custom window events that reopen a tutorial from anywhere in the app. */
export const OPEN_TOUR_EVENT = 'workflo:open-tour';
export const OPEN_BUILDER_TOUR_EVENT = 'workflo:open-builder-tour';

interface TourStep {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  hint: string;
}

export interface TourDefinition {
  id: string;
  storageKey: string;
  /** Uppercase kicker on the welcome panel. */
  asideEyebrow: string;
  /** Two-line headline on the welcome panel (array = line breaks). */
  asideHeadline: readonly string[];
  finishLabel: string;
  skipLabel: string;
  steps: readonly TourStep[];
}

export const WORKFLO_TOUR: TourDefinition = {
  id: 'workflo',
  storageKey: ONBOARDING_STORAGE_KEY,
  asideEyebrow: 'Welcome to WorkFLO',
  asideHeadline: ['Editorial workflow,', 'without the guesswork.'],
  finishLabel: 'Start using WorkFLO',
  skipLabel: 'Skip tour',
  steps: [
    {
      icon: Inbox,
      eyebrow: 'Start with what matters',
      title: 'Your prioritized work inbox',
      description:
        'See actionable, stale, and aging content across every workflow. Filter the inbox, open an item, and take the commands its current Sitecore state allows.',
      hint: 'Start here each day to find the work that needs attention first.',
    },
    {
      icon: Sparkles,
      eyebrow: 'Review with confidence',
      title: 'Run an advisory AI quality check',
      description:
        'Use AI check before a workflow decision to review brand alignment, reasons, and suggestions. Results never approve, reject, publish, rewrite, or block your commands.',
      hint: 'Rerun the check whenever WorkFLO marks an earlier result as stale.',
    },
    {
      icon: GitBranch,
      eyebrow: 'Move work forward',
      title: 'Use the right workflow action',
      description:
        'Review an item’s status and history, add comments, then confirm the Sitecore command you want to run. WorkFLO always shows the destination before it acts.',
      hint: 'Available actions come directly from the item’s live workflow state.',
    },
    {
      icon: PencilRuler,
      eyebrow: 'Design the process',
      title: 'Build and assign workflows',
      description:
        'Create states and transitions in the Builder, then use content browsing only when you need to assign an item to a workflow. Page content stays in Sitecore’s editors.',
      hint: 'FLO can explain a workflow or prepare a definition change for your confirmation.',
    },
    {
      icon: Bot,
      eyebrow: 'Meet your guide',
      title: 'Ask FLO whenever you need help',
      description:
        'Open FLO from the pulsing button in the lower-right corner. She understands the inbox, assignments, Page builder panel, AI checks, commands, and workflow definitions.',
      hint: 'Try asking: “How should I use the work inbox?”',
    },
  ],
};

export const BUILDER_TOUR: TourDefinition = {
  id: 'builder',
  storageKey: BUILDER_ONBOARDING_STORAGE_KEY,
  asideEyebrow: 'Builder tutorial',
  asideHeadline: ['Your first workflow,', 'from canvas to Sitecore.'],
  finishLabel: 'Start building',
  skipLabel: 'Skip tutorial',
  steps: [
    {
      icon: Workflow,
      eyebrow: 'Step 1 · Name it',
      title: 'Give your workflow a clear name',
      description:
        'Type a name editors will recognize, like “New Brand Review”. The Builder warns you if a workflow with the same name already exists in Sitecore.',
      hint: 'The name becomes the real workflow item under /sitecore/system/Workflows.',
    },
    {
      icon: PencilRuler,
      eyebrow: 'Step 2 · Add states',
      title: 'Create the states content moves through',
      description:
        'Use “Add state” to place states on the canvas, then name each one in the inspector. Mark exactly one state as initial — where new content enters — and mark the states that count as done as final.',
      hint: 'A simple flow is Draft (initial) → Review → Approved (final).',
    },
    {
      icon: GitBranch,
      eyebrow: 'Step 3 · Connect transitions',
      title: 'Draw transitions and name their commands',
      description:
        'Drag the ring on a state’s right edge onto another state to connect them, then name the command — like “Submit” or “Approve”. Commands are the actions editors will see on items in that state.',
      hint: 'Keyboard users can add transitions from a selected state’s “Add transition to…” control.',
    },
    {
      icon: ListChecks,
      eyebrow: 'Step 4 · Validate',
      title: 'Fix anything the Builder flags',
      description:
        'WorkFLO checks your design as you go: every state needs a name, one initial state, at least one final state, and no unreachable dead ends. Problems appear in a list until the design is ready.',
      hint: 'The create button stays disabled until every problem is resolved.',
    },
    {
      icon: CloudUpload,
      eyebrow: 'Step 5 · Create it',
      title: 'Create the workflow in Sitecore',
      description:
        'Press “Create workflow in Sitecore” to create the real definition — workflow, states, and transition commands — in one step. There is no separate publish step for the definition itself; once created, it exists in Sitecore.',
      hint: 'Editing existing workflows, actions, and command security stay in native Sitecore tools.',
    },
    {
      icon: FileCheck2,
      eyebrow: 'Step 6 · Apply it',
      title: 'Apply the workflow to a page',
      description:
        'Open your new workflow and choose “Apply to content”. Browse the content tree, pick an explicit set of items, review the impact summary, and confirm — each item enters the workflow at its initial state.',
      hint: 'Nothing is ever applied site-wide; you always choose the exact items.',
    },
    {
      icon: BadgeCheck,
      eyebrow: 'Step 7 · Reach publishable',
      title: 'Move content toward a final state',
      description:
        'Assigned pages now appear in the work inbox. Editors run your commands to move each page from state to state; when a page reaches a final state, Sitecore considers it approved and ready to publish.',
      hint: 'Publishing the page itself still happens through Sitecore’s publishing pipeline.',
    },
  ],
};

export function OnboardingTour({
  tour = WORKFLO_TOUR,
  open,
  onOpenChange,
}: {
  tour?: TourDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const steps = tour.steps;
  const current = steps[Math.min(step, steps.length - 1)]!;
  const Icon = current.icon;

  useEffect(() => {
    if (!open) return;
    // Replaying always restarts from the first step.
    setStep(0);
    window.setTimeout(() => closeRef.current?.focus(), 0);
  }, [open, tour.id]);

  // Dismissing (close button, skip, Escape) counts as completion so the
  // tutorial never re-opens automatically; it stays replayable on demand.
  const finish = () => {
    try {
      window.localStorage.setItem(tour.storageKey, 'complete');
    } catch {
      // Storage can be unavailable in strict embedded-browser contexts.
    }
    onOpenChange(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finishRef.current();
      if (event.key === 'ArrowRight' && step < steps.length - 1) setStep((value) => value + 1);
      if (event.key === 'ArrowLeft' && step > 0) setStep((value) => value - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, step, steps.length]);

  if (!open) return null;

  const titleId = `workflo-tour-title-${tour.id}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={tour.id === 'workflo' ? 'onboarding-tour' : `onboarding-tour-${tour.id}`}
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/15 bg-background shadow-2xl">
        <div className="grid min-h-[540px] md:grid-cols-[0.9fr_1.1fr]">
          <div className="relative hidden overflow-hidden bg-primary p-8 text-inverse-text md:flex md:flex-col">
            <div className="absolute -left-16 top-28 size-56 rounded-full border border-white/15" />
            <div className="absolute -bottom-20 -right-10 size-72 rounded-full border border-white/15" />
            <div className="relative rounded-xl bg-white p-3 shadow-lg">
              <WorkFLOLogo />
            </div>
            <div className="relative mt-auto">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                {tour.asideEyebrow}
              </p>
              <p className="mt-3 text-3xl font-semibold leading-tight">
                {tour.asideHeadline.map((line, index) => (
                  <span key={index}>
                    {index > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
              <div className="mt-8 flex gap-1.5">
                {steps.map((_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 rounded-full transition-all ${
                      index === step ? 'w-8 bg-white' : 'w-3 bg-white/35'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="md:hidden">
                <WorkFLOLogo />
              </div>
              <span className="ml-auto text-xs font-medium text-muted-foreground">
                {step + 1} of {steps.length}
              </span>
              <Button
                ref={closeRef}
                size="icon"
                variant="ghost"
                className="-mr-2 -mt-2 size-8"
                onClick={finish}
                aria-label="Close tutorial"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex flex-1 flex-col justify-center py-8">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary-bg text-primary-fg">
                <Icon className="size-7" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {current.eyebrow}
              </p>
              <h2 id={titleId} className="mt-2 text-2xl font-semibold tracking-tight">
                {current.title}
              </h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{current.description}</p>
              <div className="mt-6 flex gap-3 rounded-xl border border-border bg-neutral-bg/60 p-3.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-fg" />
                <p className="text-xs leading-5 text-foreground">{current.hint}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
              <Button
                variant="ghost"
                onClick={() => (step === 0 ? finish() : setStep((value) => value - 1))}
              >
                {step === 0 ? tour.skipLabel : 'Back'}
              </Button>
              <Button
                onClick={() =>
                  step === steps.length - 1 ? finish() : setStep((value) => value + 1)
                }
                data-testid="button-tour-next"
              >
                {step === steps.length - 1 ? tour.finishLabel : 'Next'}
                {step < steps.length - 1 && <ArrowRight className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
