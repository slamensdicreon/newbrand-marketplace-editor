import { useMemo } from 'react';
import { Globe, Radio, AlertCircle, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { SECTION_DEFINITIONS } from '@/lib/home-content';
import {
  useHost,
  useEditorUser,
  useSiteSummary,
} from '@/lib/marketplace/provider';

const GROUP_ORDER = ['Hero', 'Homepage sections'] as const;

export default function Dashboard() {
  const host = useHost();
  const site = useSiteSummary();
  const user = useEditorUser();

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      sections: SECTION_DEFINITIONS.filter((s) => s.group === group),
    })).filter((g) => g.sections.length > 0);
  }, []);

  const initials = user.data?.name
    ? user.data.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  return (
    <div className="min-h-full w-full bg-background pb-24">
      <PageHeader
        title="Home Editor"
        subtitle="New Brand homepage"
        right={
          user.isLoading ? (
            <Skeleton className="size-8 rounded-full" />
          ) : user.data ? (
            <Avatar className="size-8" data-testid="avatar-editor">
              <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
          ) : null
        }
      />

      <main className="mx-auto w-full max-w-2xl px-4 py-5">
        {/* Site status card */}
        <section
          className="rounded-xl border border-border bg-card p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
          style={{ animationDuration: '360ms' }}
          data-testid="card-site-status"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Globe className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              {site.isLoading ? (
                <div className="space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ) : site.isError ? (
                <SiteError onRetry={() => site.refetch()} />
              ) : site.data ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      className="text-sm font-semibold text-foreground"
                      data-testid="text-site-name"
                    >
                      {site.data.siteName}
                    </h2>
                    <Badge colorScheme="neutral" className="font-mono text-[10px]">
                      {site.data.environment}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {site.data.homePath}
                  </p>
                </>
              ) : null}
            </div>
          </div>

          <Separator className="my-3.5" />

          <div className="flex items-center justify-between gap-3">
            <ConnectionPill mode={host?.mode ?? null} />
            {user.data && (
              <p
                className="truncate text-xs text-muted-foreground"
                data-testid="text-editor-name"
              >
                Signed in as{' '}
                <span className="font-medium text-foreground">
                  {user.data.name}
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Sections */}
        <div className="mt-6 space-y-6">
          {grouped.map(({ group, sections }) => (
            <section key={group} data-testid={`group-${group}`}>
              <div className="mb-2.5 flex items-baseline justify-between px-0.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground/70">
                  {sections.length}
                </span>
              </div>
              <div className="space-y-2">
                {sections.map((section, i) => (
                  <SectionCard key={section.id} section={section} index={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function ConnectionPill({ mode }: { mode: 'live' | 'demo' | null }) {
  const isLive = mode === 'live';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        isLive
          ? 'bg-primary/10 text-primary'
          : 'bg-secondary text-secondary-foreground',
      )}
      data-testid="status-connection"
    >
      <Radio
        className={cn('size-3.5', isLive && 'motion-safe:animate-pulse')}
      />
      {isLive ? 'Connected · Live' : 'Connected · Demo'}
    </span>
  );
}

function SiteError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="size-4" />
        <span>Couldn&apos;t load site details</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        data-testid="button-retry-site"
      >
        <RefreshCw className="size-3.5" />
        Retry
      </Button>
    </div>
  );
}
