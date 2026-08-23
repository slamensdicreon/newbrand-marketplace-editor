import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/lib/home-content';

interface SectionFieldProps {
  field: FieldDefinition;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

/**
 * One editable field with label, help text, live character count and inline
 * validation. Composes the design-system Input/Textarea primitives.
 */
export function SectionField({ field, value, error, onChange }: SectionFieldProps) {
  const id = `field-${field.key}`;
  const count = value.length;
  const over = count > field.maxLength;
  const near = !over && count >= field.maxLength - Math.ceil(field.maxLength * 0.1);
  const describedBy = [
    field.help ? `${id}-help` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
        </Label>
        <span
          className={cn(
            'font-mono text-xs tabular-nums transition-colors',
            over
              ? 'text-destructive'
              : near
                ? 'text-foreground'
                : 'text-muted-foreground',
          )}
          data-testid={`count-${field.key}`}
        >
          {count}/{field.maxLength}
        </span>
      </div>

      {field.kind === 'multiline' ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || over}
          aria-describedby={describedBy || undefined}
          rows={3}
          className={cn(
            'resize-y transition-shadow',
            (error || over) &&
              'border-destructive focus-visible:ring-destructive',
          )}
          data-testid={`input-${field.key}`}
        />
      ) : (
        <Input
          id={id}
          type={field.kind === 'href' ? 'text' : 'text'}
          inputMode={field.kind === 'href' ? 'url' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || over}
          aria-describedby={describedBy || undefined}
          className={cn(
            'transition-shadow',
            field.kind === 'href' && 'font-mono text-sm',
            (error || over) &&
              'border-destructive focus-visible:ring-destructive',
          )}
          data-testid={`input-${field.key}`}
        />
      )}

      {error ? (
        <p
          id={`${id}-error`}
          className="text-xs font-medium text-destructive animate-in fade-in slide-in-from-top-1 duration-200"
          data-testid={`error-${field.key}`}
        >
          {error}
        </p>
      ) : field.help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      ) : null}
    </div>
  );
}
