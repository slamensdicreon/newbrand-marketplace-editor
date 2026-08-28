/**
 * Brand Review (Sitecore AI) domain model and pure helpers.
 *
 * The app uses Sitecore's Brand Review AI skill (Marketplace SDK `ai`
 * package, `ai.skills.generateBrandReview`) to help reviewers judge
 * content quality BEFORE approving it. Results are advisory only:
 * nothing in this module — and nothing anywhere in the app — lets an AI
 * result execute, block, or override a Sitecore workflow command.
 */

/** One piece of item text submitted for review. */
export interface ReviewContentEntry {
  /** Where the text came from. */
  source: 'field' | 'datasource';
  /** Human-readable label (field name, or "Datasource · Field"). */
  label: string;
  /** Plain text (markup already stripped). */
  text: string;
}

/** Everything gathered for one item review, with exact identity. */
export interface ReviewContent {
  itemId: string;
  language: string;
  version: number | null;
  /** Item's __Updated timestamp when the content was gathered. */
  updatedAt: string | null;
  entries: ReviewContentEntry[];
  /** True when entries were dropped/shortened to respect request limits. */
  truncated: boolean;
}

/** Per-field finding inside a section review. */
export interface BrandReviewFieldFinding {
  fieldId: string;
  /** 1 (poor) to 5 (excellent). */
  score: number;
  reason: string;
  suggestion: string;
}

/** One brand-kit section's review. */
export interface BrandReviewSectionResult {
  sectionId: string;
  score: number;
  reason: string;
  suggestion: string;
  fields: BrandReviewFieldFinding[];
}

/** A completed review, pinned to the exact content it reviewed. */
export interface BrandReviewResult {
  /** ISO timestamp when the review was generated. */
  generatedAt: string;
  /** Fingerprint of the reviewed content (see contentFingerprint). */
  fingerprint: string;
  /** The item's __Updated value at review time — used for staleness. */
  contentUpdatedAt: string | null;
  /** True when the result is a deterministic demo sample, not live AI. */
  demo: boolean;
  /** True when the submitted content was truncated to fit limits. */
  truncated: boolean;
  sections: BrandReviewSectionResult[];
}

/** Whether the connected Sitecore organization can run Brand Review. */
export interface BrandReviewSupport {
  available: boolean;
  brandKitId: string | null;
  /** Reviewer-facing explanation when unavailable. */
  message: string | null;
}

/* ------------------------------------------------------------------ */
/* Limits (privacy boundary: submit only what is needed, bounded)      */
/* ------------------------------------------------------------------ */

/** Max total characters of text submitted in one review request. */
export const MAX_REVIEW_CHARS = 16_000;
/** Max number of text entries submitted in one review request. */
export const MAX_REVIEW_ENTRIES = 40;
/** Max characters kept per entry. */
export const MAX_ENTRY_CHARS = 4_000;
/** Overall scores at or below this warn the reviewer before approving. */
export const LOW_SCORE_THRESHOLD = 2;

/** Field names never submitted (system/identity fields carry no copy). */
const EXCLUDED_FIELD_PREFIX = '__';

/** True when a field name may be submitted for review. */
export function isReviewableFieldName(name: string): boolean {
  return !name.startsWith(EXCLUDED_FIELD_PREFIX);
}

/** Strip markup/GUID noise from a Sitecore field value, keep plain text. */
export function extractPlainText(value: string | null | undefined): string {
  if (!value) return '';
  const withoutTags = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ');
  const text = withoutTags.replace(/\s+/g, ' ').trim();
  // Bare GUID / GUID-list values (link fields etc.) carry no reviewable copy.
  if (/^[{}0-9a-fA-F|\- ]+$/.test(text) && /[0-9a-fA-F]{8}/.test(text)) return '';
  return text;
}

/**
 * Apply the request-size limits to gathered entries. Deterministic:
 * keeps entry order, truncates long entries, drops entries beyond the
 * caps, and reports whether anything was cut.
 */
export function limitReviewEntries(entries: ReviewContentEntry[]): {
  entries: ReviewContentEntry[];
  truncated: boolean;
} {
  let truncated = false;
  const kept: ReviewContentEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    if (kept.length >= MAX_REVIEW_ENTRIES) {
      truncated = true;
      break;
    }
    let clipped = text;
    if (clipped.length > MAX_ENTRY_CHARS) {
      clipped = clipped.slice(0, MAX_ENTRY_CHARS);
      truncated = true;
    }
    if (total + clipped.length > MAX_REVIEW_CHARS) {
      const room = MAX_REVIEW_CHARS - total;
      if (room > 200) {
        kept.push({ ...entry, text: clipped.slice(0, room) });
      }
      truncated = true;
      break;
    }
    kept.push({ ...entry, text: clipped });
    total += clipped.length;
  }
  return { entries: kept, truncated };
}

/**
 * Stable fingerprint of reviewed content (identity + every entry).
 * Two gathers of identical content produce identical fingerprints, so a
 * review can be pinned to exactly what it reviewed.
 */
export function contentFingerprint(content: ReviewContent): string {
  const parts = [
    content.itemId,
    content.language,
    String(content.version ?? ''),
    ...content.entries.map((e) => `${e.source}|${e.label}|${e.text}`),
  ];
  // djb2 over the joined parts — no crypto needed, this is a change
  // detector, not a security boundary.
  let hash = 5381;
  const joined = parts.join('\u0000');
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return `fp${(hash >>> 0).toString(16)}:${joined.length}`;
}

/** Conservative overall score: the LOWEST section score. */
export function overallScore(sections: BrandReviewSectionResult[]): number | null {
  if (sections.length === 0) return null;
  return Math.min(...sections.map((s) => s.score));
}

/**
 * A review is stale when the item's __Updated timestamp no longer matches
 * the one captured at review time (content changed since the review).
 */
export function isReviewStale(
  review: Pick<BrandReviewResult, 'contentUpdatedAt'>,
  currentUpdatedAt: string | null,
): boolean {
  return (review.contentUpdatedAt ?? null) !== (currentUpdatedAt ?? null);
}

/** Human title for a brand-kit section id (e.g. "voice-and-tone"). */
export function sectionTitle(sectionId: string): string {
  const words = sectionId.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
