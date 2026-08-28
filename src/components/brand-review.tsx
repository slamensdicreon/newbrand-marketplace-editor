import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useBrandReviewSupport, useGenerateBrandReview } from '@/lib/marketplace/provider';
import {
  isReviewStale,
  overallScore,
  sectionTitle,
  LOW_SCORE_THRESHOLD,
  type BrandReviewResult,
} from '@/lib/workflow/brand-review';

/**
 * Advisory AI quality check (Sitecore Brand Review) shown on workflow
 * review surfaces. Scores inform the reviewer's decision; they never
 * execute, block, or override workflow commands — approving/rejecting is
 * always the reviewer's explicit action elsewhere in the UI.
 */
export function BrandReviewPanel({
  itemId,
  language,
  itemUpdatedAt,
  review,
  onReview,
}: {
  itemId: string;
  language: string;
  /** The item's current last-updated timestamp (for staleness). */
  itemUpdatedAt: string | null;
  /** Latest review for this item, held by the parent. */
  review: BrandReviewResult | null;
  /** Called with a freshly generated review (parent stores it). */
  onReview: (review: BrandReviewResult) => void;
}) {
  const support = useBrandReviewSupport();
  const generate = useGenerateBrandReview();

  const run = () => {
    generate.mutate(
      { itemId, language },
      { onSuccess: (result) => onReview(result) },
    );
  };

  if (support.isLoading) {
    return <Skeleton className="mt-3 h-10 w-full" data-testid="skeleton-brand-review" />;
  }
  if (support.data && !support.data.available) {
    return (
      <p className="mt-3 text-xs text-muted-foreground" data-testid="text-brand-review-unavailable">
        AI quality check unavailable: {support.data.message}
      </p>
    );
  }

  const stale = review ? isReviewStale(review, itemUpdatedAt) : false;

  return (
    <div
      className="mt-3 rounded-lg border border-border bg-neutral-bg/50 p-3"
      data-testid={`panel-brand-review-${itemId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
          <Sparkles className="size-3.5" /> AI quality check
        </span>
        {review?.demo && (
          <Badge colorScheme="neutral" data-testid="badge-review-demo">
            Demo sample — not a live AI review
          </Badge>
        )}
        {review && stale && (
          <Badge colorScheme="warning" data-testid="badge-review-stale">
            Content changed since this review
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={run}
          disabled={generate.isPending}
          data-testid={`button-run-brand-review-${itemId}`}
        >
          {generate.isPending ? (
            'Analyzing…'
          ) : review ? (
            <>
              <RefreshCw className="size-3.5" /> Re-run
            </>
          ) : (
            'Run check'
          )}
        </Button>
      </div>

      {generate.isError && (
        <p className="mt-2 text-xs text-destructive" data-testid="text-brand-review-error">
          {generate.error instanceof Error ? generate.error.message : 'The analysis failed.'}
        </p>
      )}

      {review && (
        <div className="mt-2 space-y-2" data-testid="results-brand-review">
          <p className="text-xs text-muted-foreground">
            Overall score {overallScore(review.sections) ?? '—'}/5 · generated{' '}
            {new Date(review.generatedAt).toLocaleString()}
            {review.truncated && ' · analyzed a shortened copy of long content'}
          </p>
          {(overallScore(review.sections) ?? 5) <= LOW_SCORE_THRESHOLD && (
            <Alert data-testid="alert-review-low-score">
              <AlertTriangle className="size-4" />
              <AlertTitle>Low brand score</AlertTitle>
              <AlertDescription>
                The AI flagged issues below. This is advisory only — you decide what happens to
                the item.
              </AlertDescription>
            </Alert>
          )}
          <ul className="space-y-1">
            {review.sections.map((section) => (
              <ReviewSectionRow key={section.sectionId} section={section} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewSectionRow({
  section,
}: {
  section: BrandReviewResult['sections'][number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border bg-card p-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs"
        onClick={() => setOpen((v) => !v)}
        data-testid={`button-review-section-${section.sectionId}`}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="font-medium text-foreground">{sectionTitle(section.sectionId)}</span>
        <Badge
          colorScheme={
            section.score <= LOW_SCORE_THRESHOLD
              ? 'danger'
              : section.score >= 4
                ? 'success'
                : 'warning'
          }
          className="ml-auto"
          data-testid={`badge-section-score-${section.sectionId}`}
        >
          {section.score}/5
        </Badge>
      </button>
      {open && (
        <div className="mt-2 space-y-1 pl-5 text-xs text-muted-foreground">
          <p>{section.reason}</p>
          {section.suggestion && (
            <p className="text-foreground">Suggestion: {section.suggestion}</p>
          )}
          {section.fields.length > 0 && (
            <ul className="mt-1 space-y-1">
              {section.fields.map((field) => (
                <li key={field.fieldId}>
                  <span className="font-medium text-foreground">{field.fieldId}</span> —{' '}
                  {field.score}/5. {field.reason}{' '}
                  {field.suggestion && <span>Suggestion: {field.suggestion}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One-line summary of the latest review, shown inside the
 * approval-command confirmation dialog. Informational only — it changes
 * nothing about whether or how the command runs.
 */
export function BrandReviewConfirmSummary({
  review,
  itemUpdatedAt,
}: {
  review: BrandReviewResult | null;
  itemUpdatedAt: string | null;
}) {
  if (!review) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-confirm-no-review">
        No AI quality check has been run for this item.
      </p>
    );
  }
  const score = overallScore(review.sections);
  const stale = isReviewStale(review, itemUpdatedAt);
  return (
    <div className="space-y-1" data-testid="text-confirm-review-summary">
      <p className="text-xs text-muted-foreground">
        AI quality check{review.demo ? ' (demo sample)' : ''}: score {score ?? '—'}/5 · generated{' '}
        {new Date(review.generatedAt).toLocaleString()}
        {stale && ' · content changed since this review'}
      </p>
      {score != null && score <= LOW_SCORE_THRESHOLD && (
        <p className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5" /> Low brand score — consider reviewing the
          suggestions before proceeding. Your decision still applies.
        </p>
      )}
    </div>
  );
}
