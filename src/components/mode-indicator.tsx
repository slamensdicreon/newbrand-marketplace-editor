import { CloudOff, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketplace } from '@/lib/marketplace/provider';

/**
 * Persistent, unobtrusive connection status pill shown on every screen.
 * The app never blocks on the Sitecore handshake, so this is the single
 * place that tells editors which data they are looking at:
 * - connecting  — demo data while the Sitecore handshake runs;
 * - demo        — standalone preview, changes stay local;
 * - unavailable — Sitecore could not be reached; demo data with a retry;
 * - live        — verified Sitecore connection (small confirmation dot).
 */
export function ModeIndicator() {
  const { status, retry } = useMarketplace();

  if (status.state === 'live') {
    return (
      <Shell testId="banner-live-mode">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span>Connected to Sitecore — live content</span>
      </Shell>
    );
  }

  if (status.state === 'connecting') {
    return (
      <Shell testId="banner-connecting-mode">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span>Demo data — connecting to Sitecore…</span>
      </Shell>
    );
  }

  if (status.reason === 'unavailable') {
    return (
      <Shell testId="banner-unavailable-mode">
        <CloudOff className="size-3.5 text-destructive" />
        <span title={status.message}>
          Sitecore unavailable — showing demo data. Changes are not sent to Sitecore.
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-xs"
          onClick={retry}
          data-testid="button-retry-connection"
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
      </Shell>
    );
  }

  return (
    <Shell testId="banner-demo-mode">
      <FlaskConical className="size-3.5 text-primary" />
      <span>Demo mode — changes are not sent to Sitecore</span>
    </Shell>
  );
}

function Shell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
      data-testid={testId}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-300">
        {children}
      </div>
    </div>
  );
}
