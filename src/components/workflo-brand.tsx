import { MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import icreonLogo from '@/assets/icreon-logo.png';

export function WorkFLOLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} aria-label="WorkFLO">
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background">
        <img src={icreonLogo} alt="" className="size-full object-contain" />
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-semibold leading-tight tracking-tight text-foreground">
            Work<span className="font-black text-[#386AFF]">FLO</span>
          </span>
          <span className="mt-0.5 whitespace-nowrap text-[9px] font-medium leading-tight tracking-wide text-muted-foreground">
            by Icreon for Sitecore
          </span>
        </span>
      )}
    </span>
  );
}

export function FLOAvatar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-inverse-text shadow-sm',
        className,
      )}
      aria-label="FLO"
    >
      <MessageSquareText className="size-4" aria-hidden />
      <span className="absolute -bottom-1 -right-1 rounded-full border-2 border-background bg-card px-1 text-[7px] font-black leading-3 text-primary">
        FLO
      </span>
    </span>
  );
}