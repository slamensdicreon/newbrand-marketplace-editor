import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string; onClick?: () => void };
  right?: React.ReactNode;
}

/** Workspace content header shown at the top of the main pane. */
export function PageHeader({ title, subtitle, back, right }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5">
        {back &&
          (back.onClick ? (
            <button
              type="button"
              onClick={back.onClick}
              className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-neutral-bg active:bg-neutral-bg-active"
              aria-label={back.label}
              data-testid="button-back"
            >
              <ArrowLeft className="size-4.5" />
            </button>
          ) : (
            <Link
              href={back.href}
              className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-neutral-bg active:bg-neutral-bg-active"
              aria-label={back.label}
              data-testid="link-back"
            >
              <ArrowLeft className="size-4.5" />
            </Link>
          ))}
        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-base font-semibold leading-tight text-foreground"
            data-testid="text-header-title"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}
