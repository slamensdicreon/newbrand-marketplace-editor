import { useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  CloudOff,
  ChevronRight,
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
import { useEditorUser, useMarketplace, useWorkflows } from '@/lib/marketplace/provider';
import { cn } from '@/lib/utils';
import icreonLogo from '@/assets/icreon-logo.png';

/**
 * Enterprise workspace shell: a persistent three-pane layout.
 *   1/6 — left navigation rail (product areas + workflows + connection);
 *   2/6 — conversational workflow assistant;
 *   3/6 — the routed workspace content.
 * Below the `lg` breakpoint the rail collapses to a top bar and the
 * assistant becomes a slide-over toggled from the bar, so the workspace
 * keeps a usable single-column fallback.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

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
        </nav>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setChatOpen(true)}
          data-testid="button-open-assistant"
        >
          <MessageSquareText className="size-4" /> Assistant
        </Button>
      </header>

      {/* --- Assistant (col 2 on desktop, slide-over on mobile) --- */}
      <section
        className={cn(
          'min-h-0 bg-background transition-[width,transform] duration-200',
          chatOpen
            ? 'fixed inset-0 z-40 flex flex-col motion-safe:animate-in motion-safe:slide-in-from-left-full motion-safe:duration-200 lg:static lg:z-auto lg:col-span-2 lg:border-r lg:border-border'
            : 'hidden',
        )}
      >
        <ChatPanel className="flex-1" onClose={() => setChatOpen(false)} />
      </section>

      {/* --- Workspace content (col 3-6 → spans 3) --- */}
      <main className={cn('min-h-0 flex-1 overflow-y-auto', chatOpen ? 'lg:col-span-3' : 'lg:col-span-5')}>
        {children}
      </main>
      {!chatOpen && (
        <Button
          size="icon"
          variant="outline"
          className="fixed left-[calc(16.6667%+0.75rem)] top-1/2 z-30 hidden -translate-y-1/2 rounded-full bg-background shadow-md lg:flex"
          onClick={() => setChatOpen(true)}
          aria-label="Open workflow assistant"
          data-testid="button-reopen-assistant"
        >
          <ChevronRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5" data-testid="link-brand">
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background">
        <img src={icreonLogo} alt="" className="size-full object-contain" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
            Workflow Operations
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">Sitecore</p>
        </div>
      )}
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
      <div className="border-b border-sidebar-border px-4 py-4">
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
