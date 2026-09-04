import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  CloudOff,
  CircleHelp,
  GitBranch,
  Inbox,
  Loader2,
  MessageSquareText,
  PencilRuler,
  RefreshCw,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatPanel } from '@/components/assistant/chat-panel';
import { WorkFLOLogo } from '@/components/workflo-brand';
import {
  BUILDER_ONBOARDING_STORAGE_KEY,
  BUILDER_TOUR,
  ONBOARDING_STORAGE_KEY,
  OPEN_BUILDER_TOUR_EVENT,
  OPEN_TOUR_EVENT,
  OnboardingTour,
  WORKFLO_TOUR,
} from '@/components/onboarding-tour';
import { useEditorUser, useMarketplace, useWorkflows } from '@/lib/marketplace/provider';
import { cn } from '@/lib/utils';

/**
 * Enterprise workspace shell with persistent navigation and a floating
 * assistant. Chat is deliberately outside the page grid so opening it never
 * reflows the editor's working area.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [builderTourOpen, setBuilderTourOpen] = useState(false);
  const [location] = useLocation();
  const onBuilder = location === '/builder' || location.startsWith('/builder/');

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== 'complete') {
        setTourOpen(true);
      }
    } catch {
      setTourOpen(true);
    }
  }, []);

  // First visit to the Builder opens its own tutorial, tracked independently
  // of the general tour. If the general tour is currently showing, wait until
  // it closes so the two overlays never stack.
  useEffect(() => {
    if (!onBuilder || tourOpen || builderTourOpen) return;
    try {
      // The general first-visit tour has priority; the Escape/close of that
      // tour flips `tourOpen`, re-running this effect.
      if (window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== 'complete') return;
      if (window.localStorage.getItem(BUILDER_ONBOARDING_STORAGE_KEY) !== 'complete') {
        setBuilderTourOpen(true);
      }
    } catch {
      setBuilderTourOpen(true);
    }
  }, [onBuilder, tourOpen, builderTourOpen]);

  useEffect(() => {
    const openTour = () => {
      setBuilderTourOpen(false);
      setTourOpen(true);
    };
    const openBuilderTour = () => {
      setTourOpen(false);
      setBuilderTourOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, openTour);
    window.addEventListener(OPEN_BUILDER_TOUR_EVENT, openBuilderTour);
    return () => {
      window.removeEventListener(OPEN_TOUR_EVENT, openTour);
      window.removeEventListener(OPEN_BUILDER_TOUR_EVENT, openBuilderTour);
    };
  }, []);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-muted/40 lg:grid lg:grid-cols-6">
      {/* --- Left rail (col 1) --- */}
      <aside className="hidden min-h-0 border-r border-sidebar-border bg-sidebar lg:col-span-1 lg:flex lg:flex-col">
        <NavRail />
      </aside>

      {/* --- Compact top bar (mobile/tablet) --- */}
      <header className="flex items-center gap-2 border-b border-border bg-background px-3 py-2 lg:hidden">
        <Brand compact />
        <nav className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <TopLink href="/" label="Work inbox" />
          <TopLink href="/workflows" label="Workflows" />
          <TopLink href="/builder" label="Builder" />
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
          <TopTourButton
            label="Overview"
            event={OPEN_TOUR_EVENT}
            testId="button-open-workflo-tour-mobile"
          />
          <TopTourButton
            label="Builder guide"
            event={OPEN_BUILDER_TOUR_EVENT}
            testId="button-open-builder-tour-mobile"
          />
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto lg:col-span-5">{children}</main>

      {chatOpen ? (
        <section
          role="dialog"
          aria-label="Chat with FLO"
          className="fixed inset-x-3 bottom-3 top-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(720px,calc(100dvh-3rem))] sm:w-[min(440px,calc(100vw-3rem))]"
        >
          <ChatPanel className="flex-1" onClose={() => setChatOpen(false)} />
        </section>
      ) : (
        <div className="fixed bottom-5 right-5 z-40 sm:bottom-6 sm:right-6">
          <span className="absolute inset-0 rounded-full bg-primary/35 motion-safe:animate-ping" />
          <Button
            size="icon"
            className="relative size-12 rounded-full shadow-lg transition-transform hover:scale-110"
            onClick={() => setChatOpen(true)}
            aria-label="Chat with FLO"
            data-testid="button-open-assistant"
          >
            <MessageSquareText className="size-5" />
          </Button>
        </div>
      )}
      <OnboardingTour tour={WORKFLO_TOUR} open={tourOpen} onOpenChange={setTourOpen} />
      <OnboardingTour tour={BUILDER_TOUR} open={builderTourOpen} onOpenChange={setBuilderTourOpen} />
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5" data-testid="link-brand">
      <WorkFLOLogo compact={compact} />
      {!compact && <span className="sr-only">Sitecore workflow operations</span>}
    </Link>
  );
}

function TopLink({ href, label }: { href: string; label: string }) {
  const [active] = useRoute(href);
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-neutral-bg text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

/** Mobile "How It Works" entry: replays a tutorial from the top bar. */
function TopTourButton({
  label,
  event,
  testId,
}: {
  label: string;
  event: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(event))}
      className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      data-testid={testId}
    >
      <CircleHelp className="size-3.5" /> {label}
    </button>
  );
}

function NavRail() {
  const workflows = useWorkflows();
  const user = useEditorUser();
  const [location] = useLocation();

  const initials = user.data?.name
    ? user.data.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  return (
    <>
      <div className="border-b border-border px-4 py-3.5">
        <Brand />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        <NavSection label="Operate">
          <NavItem href="/" icon={Inbox} label="Work inbox" exact />
          <NavItem href="/workflows" icon={GitBranch} label="Workflows" exact />
        </NavSection>

        <NavSection label="Workflows">
          {workflows.isLoading ? (
            <div className="space-y-1.5 px-2.5 py-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : (
            (workflows.data ?? []).map((wf) => (
              <NavItem
                key={wf.workflowId}
                href={`/workflows/${encodeURIComponent(wf.workflowId)}`}
                icon={GitBranch}
                label={wf.displayName}
                active={location.startsWith(`/workflows/${encodeURIComponent(wf.workflowId)}`)}
              />
            ))
          )}
          <NavItem href="/builder" icon={PencilRuler} label="Builder" exact />
        </NavSection>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="mb-3" aria-label="How It Works">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            How It Works
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT))}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-sidebar-foreground"
            data-testid="button-open-workflo-tour"
          >
            <CircleHelp className="size-3.5 shrink-0" /> WorkFLO overview
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_BUILDER_TOUR_EVENT))}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-sidebar-foreground"
            data-testid="button-open-builder-tour"
          >
            <PencilRuler className="size-3.5 shrink-0" /> Build your first workflow
          </button>
        </div>
        <ConnectionState />
        {user.data && (
          <div className="mt-3 flex items-center gap-2">
            <Avatar className="size-7" data-testid="avatar-editor">
              <AvatarFallback className="bg-accent text-[10px] font-semibold text-accent-foreground">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
            <p className="truncate text-xs text-sidebar-foreground" data-testid="text-nav-user">
              {user.data.name}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  exact,
  active: activeOverride,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  exact?: boolean;
  active?: boolean;
}) {
  const [routeActive] = useRoute(href);
  const [location] = useLocation();
  const active =
    activeOverride ?? (exact ? routeActive : routeActive || location.startsWith(`${href}/`));
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )}
        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

function ConnectionState() {
  const { status, retry } = useMarketplace();
  if (status.state === 'live') {
    return (
      <div className="flex items-center gap-2 text-xs text-sidebar-foreground" data-testid="nav-status-live">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Live Sitecore data
      </div>
    );
  }
  if (status.state === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="nav-status-connecting">
        <Loader2 className="size-3.5 animate-spin text-primary" /> Connecting to Sitecore…
      </div>
    );
  }
  if (status.reason === 'unavailable') {
    return (
      <div className="space-y-1.5" data-testid="nav-status-unavailable">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 text-destructive" /> Sitecore unavailable
        </div>
        <Button size="sm" variant="outline" className="h-6 w-full gap-1 text-xs" onClick={retry}>
          <RefreshCw className="size-3" /> Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="nav-status-demo">
      <span className="size-2 rounded-full bg-primary/60" aria-hidden /> Demo mode
    </div>
  );
}
