import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  AlertCircle,
  Check,
  RefreshCw,
  RotateCcw,
  Save,
  FileText,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SectionField } from '@/components/section-field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getSection,
  validateSection,
  isSectionDirty,
  type SectionValues,
} from '@/lib/home-content';
import { useHostKey, useSectionContent, useSaveSection } from '@/lib/marketplace/provider';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import NotFound from '@/pages/not-found';

export default function SectionEditor() {
  const params = useParams();
  const id = params.id ?? '';
  const section = getSection(id);

  // Remount the editor whenever the host generation changes (e.g. the demo
  // host is swapped for the verified live host). This drops any in-memory
  // demo-era edits so they can never become "dirty" values that a Save would
  // then send to Sitecore.
  const hostKey = useHostKey();

  if (!section) return <NotFound />;
  return <SectionEditorInner key={`${hostKey}:${id}`} id={id} section={section} />;
}

function SectionEditorInner({
  id,
  section,
}: {
  id: string;
  section: NonNullable<ReturnType<typeof getSection>>;
}) {
  const [, setLocation] = useLocation();
  const content = useSectionContent(id);
  const save = useSaveSection(section);

  // Local editable state, initialized once per section from the server values.
  const [values, setValues] = useState<SectionValues>({});
  const initializedForId = useRef<string | null>(null);
  const baseline = useMemo<SectionValues>(
    () => content.data ?? {},
    [content.data],
  );

  useEffect(() => {
    if (content.data && initializedForId.current !== id) {
      initializedForId.current = id;
      // Restore an in-progress draft from this tab if one exists (e.g. after
      // an accidental back navigation or refresh); otherwise start from the
      // saved values.
      const draft = loadDraft(id);
      setValues({ ...content.data, ...(draft ?? {}) });
    }
  }, [content.data, id]);

  const dirty = useMemo(() => {
    if (initializedForId.current !== id) return false;
    return isSectionDirty(section, baseline, values);
  }, [section, baseline, values, id]);

  // Persist in-progress edits per tab so navigation can never lose them; a
  // draft is removed as soon as values return to the saved baseline.
  useEffect(() => {
    if (initializedForId.current !== id) return;
    if (dirty) {
      saveDraft(id, values);
    } else {
      clearDraft(id);
    }
  }, [dirty, values, id]);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of validateSection(section, values)) {
      map[e.fieldKey] = e.message;
    }
    return map;
  }, [section, values]);

  const [showErrors, setShowErrors] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);

  const hasErrors = Object.keys(fieldErrors).length > 0;

  const setField = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    if (hasErrors) {
      setShowErrors(true);
      toast.error('Fix the highlighted fields', {
        description: 'A few fields need attention before saving.',
      });
      return;
    }
    // Only send fields that actually changed.
    const changed: SectionValues = {};
    for (const f of section.fields) {
      const next = values[f.key] ?? '';
      if (next !== (baseline[f.key] ?? '')) changed[f.key] = next;
    }
    save.mutate(changed, {
      onSuccess: () => {
        setShowErrors(false);
        clearDraft(id);
        toast.success('Changes saved', {
          description: `${section.title} is up to date.`,
        });
      },
      onError: (err) => {
        setShowErrors(true);
        toast.error('Save failed', {
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      },
    });
  }

  function handleRevert() {
    setValues({ ...baseline });
    setShowErrors(false);
    save.reset();
    clearDraft(id);
  }

  function handleBack() {
    if (dirty) {
      setGuardOpen(true);
    } else {
      setLocation('/');
    }
  }

  // Intercept browser/hardware back and tab-close while dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Push a sentinel history entry so pressing Back while dirty fires a
    // popstate we can absorb: restore the editor URL explicitly (Back may
    // have already moved history to a previous entry) and open the discard
    // dialog instead of leaving the page. Should the router still manage to
    // transition, the sessionStorage draft above guarantees no edits are
    // lost when the editor is reopened.
    const editorUrl = window.location.href;
    window.history.pushState({ unsavedGuard: true }, '', editorUrl);
    const onPopState = () => {
      window.history.pushState({ unsavedGuard: true }, '', editorUrl);
      setGuardOpen(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      // Drop the sentinel entry when the guard deactivates (saved/reverted).
      if (window.history.state?.unsavedGuard) {
        window.history.back();
      }
    };
  }, [dirty]);

  return (
    <div className="min-h-[100dvh] w-full bg-background pb-40">
      <PageHeader
        title={section.title}
        subtitle={section.group}
        back={{ href: '/', label: 'Back to dashboard', onClick: handleBack }}
        right={
          dirty ? (
            <Badge
              colorScheme="primary"
              className="gap-1.5"
              data-testid="badge-dirty"
            >
              <span className="size-1.5 rounded-full bg-current" />
              Unsaved
            </Badge>
          ) : (
            <Badge
              colorScheme="neutral"
              className="gap-1.5"
              data-testid="badge-saved"
            >
              <Check className="size-3" />
              Saved
            </Badge>
          )
        }
      />

      <main className="mx-auto w-full max-w-2xl px-4 py-5">
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-card p-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{section.blurb}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {section.itemPath}
            </p>
          </div>
        </div>

        {content.isLoading ? (
          <FieldsSkeleton count={section.fields.length} />
        ) : content.isError ? (
          <LoadError onRetry={() => content.refetch()} />
        ) : (
          <>
            {save.isError && (
              <Alert variant="danger" className="mb-5" data-testid="alert-save-error">
                <AlertCircle className="size-4" />
                <AlertTitle>Couldn&apos;t save</AlertTitle>
                <AlertDescription>
                  {save.error instanceof Error
                    ? save.error.message
                    : 'Something went wrong while saving.'}
                </AlertDescription>
              </Alert>
            )}

            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
            >
              {section.fields.map((field) => (
                <SectionField
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ''}
                  error={showErrors ? fieldErrors[field.key] : undefined}
                  onChange={(v) => setField(field.key, v)}
                />
              ))}
              {/* Hidden submit keeps Enter-to-save on single-line inputs. */}
              <button type="submit" className="sr-only" tabIndex={-1} aria-hidden />
            </form>
          </>
        )}
      </main>

      {/* Sticky action bar */}
      {!content.isLoading && !content.isError && (
        <div
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur transition-transform duration-200',
          )}
        >
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2.5 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleRevert}
              disabled={!dirty || save.isPending}
              data-testid="button-revert"
            >
              <RotateCcw className="size-4" />
              Revert
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={!dirty || save.isPending}
              data-testid="button-save"
            >
              {save.isPending ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={guardOpen} onOpenChange={setGuardOpen}>
        <AlertDialogContent data-testid="dialog-unsaved">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits to {section.title} that haven&apos;t been saved.
              Leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-stay">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearDraft(id);
                setValues({ ...baseline });
                setGuardOpen(false);
                setLocation('/');
              }}
              data-testid="button-discard"
            >
              Discard &amp; leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldsSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-5" data-testid="skeleton-fields">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card px-6 py-12 text-center"
      data-testid="error-load-section"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Couldn&apos;t load this section
        </p>
        <p className="text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry} data-testid="button-retry-load">
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
}
