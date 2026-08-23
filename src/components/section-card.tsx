import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import type { SectionDefinition } from '@/lib/home-content';

interface SectionCardProps {
  section: SectionDefinition;
  index: number;
}

/**
 * A tappable row linking to a section's editor. Staggered entrance is driven by
 * `index` so lists animate in sequence.
 */
export function SectionCard({ section, index }: SectionCardProps) {
  return (
    <Link
      href={`/sections/${section.id}`}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-neutral-bg active:bg-neutral-bg-active motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both active:scale-[0.99]"
      style={{ animationDelay: `${index * 55}ms`, animationDuration: '360ms' }}
      data-testid={`link-section-${section.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {section.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {section.blurb}
        </p>
        <p className="mt-1 text-[11px] font-medium text-muted-foreground/80">
          {section.fields.length} field{section.fields.length === 1 ? '' : 's'}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
