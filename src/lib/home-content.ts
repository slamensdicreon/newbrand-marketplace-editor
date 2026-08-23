/**
 * Content model for the New Brand homepage sections that this Marketplace
 * app can edit. Each section maps 1:1 to a Sitecore datasource item that
 * already exists in the New Brand site (see authoring/items in the repo).
 *
 * Only plain-text / link-text fields are exposed in this first release —
 * image and media fields are intentionally out of scope.
 */

export type FieldKind = 'text' | 'multiline' | 'href';

export interface FieldDefinition {
  /** Sitecore field name on the datasource item. */
  key: string;
  label: string;
  kind: FieldKind;
  maxLength: number;
  required?: boolean;
  help?: string;
}

export interface SectionDefinition {
  id: string;
  title: string;
  /** Short editor-facing description of where this content appears. */
  blurb: string;
  /** Grouping shown on the dashboard. */
  group: 'Hero' | 'Homepage sections';
  /** Sitecore item ID (GUID) of the datasource item — used for authoring writes. */
  itemId: string;
  /** Sitecore item path of the datasource item (informational). */
  itemPath: string;
  fields: FieldDefinition[];
}

export type SectionValues = Record<string, string>;
export type HomeContent = Record<string, SectionValues>;

export interface FieldError {
  fieldKey: string;
  message: string;
}

const heroFields: FieldDefinition[] = [
  { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
  { key: 'headlineLine1', label: 'Headline line 1', kind: 'text', maxLength: 40, required: true },
  { key: 'headlineLine2', label: 'Headline line 2', kind: 'text', maxLength: 40 },
  { key: 'description', label: 'Description', kind: 'multiline', maxLength: 160, required: true },
];

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    id: 'hero-build',
    itemId: '{69C91CC5-B0C6-55AC-AD3C-E64BC98FF337}',
    title: 'Hero — Ready to Build',
    blurb: 'First panel of the homepage hero triptych.',
    group: 'Hero',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Hero/Ready to Build',
    fields: heroFields,
  },
  {
    id: 'hero-assemble',
    itemId: '{C47EA5C6-7181-5996-9E29-AF7898A5127F}',
    title: 'Hero — Ready to Assemble',
    blurb: 'Second panel of the homepage hero triptych.',
    group: 'Hero',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Hero/Ready to Assemble',
    fields: heroFields,
  },
  {
    id: 'hero-raise',
    itemId: '{9174DB72-AAEF-5454-A5C6-164B6CBC77BB}',
    title: 'Hero — Ready to Raise',
    blurb: 'Third panel of the homepage hero triptych.',
    group: 'Hero',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Hero/Ready to Raise',
    fields: heroFields,
  },
  {
    id: 'search-dock',
    itemId: '{0E3956A7-B2D3-54C2-A1A9-9093D31F3FAE}',
    title: 'Search dock',
    blurb: 'Catalog search bar directly under the hero.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Search Dock',
    fields: [
      { key: 'placeholderText', label: 'Search placeholder', kind: 'text', maxLength: 90, required: true },
      { key: 'emptyMessage', label: 'No-results message', kind: 'text', maxLength: 90, required: true },
      { key: 'locationName', label: 'Location name', kind: 'text', maxLength: 40, required: true },
      { key: 'locationMeta', label: 'Location distance', kind: 'text', maxLength: 20 },
      { key: 'locationHours', label: 'Location hours', kind: 'text', maxLength: 40 },
    ],
  },
  {
    id: 'capabilities',
    itemId: '{B2E42069-8B6A-58CA-8E80-B7DB2117D41F}',
    title: 'Capabilities',
    blurb: '"Ready means built before it ships" section.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Capabilities',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 80, required: true },
      { key: 'description', label: 'Description', kind: 'multiline', maxLength: 200, required: true },
      { key: 'ctaLabel', label: 'CTA label', kind: 'text', maxLength: 60, required: true },
      { key: 'ctaHref', label: 'CTA link', kind: 'href', maxLength: 200, required: true },
      { key: 'bandEyebrow', label: 'Plant band eyebrow', kind: 'text', maxLength: 40 },
      { key: 'bandTitle', label: 'Plant band title', kind: 'text', maxLength: 90 },
      { key: 'bandDescription', label: 'Plant band description', kind: 'multiline', maxLength: 200 },
    ],
  },
  {
    id: 'catalog',
    itemId: '{C2B7B359-BD87-5C73-9D1B-6366A569E3D6}',
    title: 'Catalog',
    blurb: '"Everything else? Also ready." catalog grid.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Catalog',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 80, required: true },
      { key: 'description', label: 'Description', kind: 'multiline', maxLength: 200, required: true },
      { key: 'ctaLabel', label: 'CTA label', kind: 'text', maxLength: 60, required: true },
      { key: 'ctaHref', label: 'CTA link', kind: 'href', maxLength: 200, required: true },
      { key: 'supportText', label: 'Support text', kind: 'text', maxLength: 80 },
    ],
  },
  {
    id: 'greener',
    itemId: '{CE3E55DA-D8A8-5858-BC2B-B2FB967A0B57}',
    title: 'Greener way to build',
    blurb: 'Sustainability video section.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Greener',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 120, required: true },
      { key: 'description', label: 'Description', kind: 'multiline', maxLength: 220, required: true },
      { key: 'linkLabel', label: 'Link label', kind: 'text', maxLength: 60 },
      { key: 'linkHref', label: 'Link target', kind: 'href', maxLength: 200 },
    ],
  },
  {
    id: 'quote',
    itemId: '{BACDA11E-B71E-5B9C-9B19-C5665BED7ECA}',
    title: 'Quote',
    blurb: '"How ready should yours arrive?" quote CTA.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Quote',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 90, required: true },
      { key: 'description', label: 'Description', kind: 'multiline', maxLength: 220, required: true },
      { key: 'ctaLabel', label: 'CTA label', kind: 'text', maxLength: 60, required: true },
      { key: 'ctaHref', label: 'CTA link', kind: 'href', maxLength: 200, required: true },
      { key: 'noteLine1', label: 'Note line 1', kind: 'text', maxLength: 60 },
      { key: 'noteLine2', label: 'Note line 2', kind: 'text', maxLength: 60 },
    ],
  },
  {
    id: 'know-how',
    itemId: '{E70D10BC-6864-5125-A197-455F65F7BB5B}',
    title: 'Know-how',
    blurb: '"Ready isn\'t luck" engineering section.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Know-How',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', maxLength: 40, required: true },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 90, required: true },
      { key: 'sideText', label: 'Side text', kind: 'multiline', maxLength: 160 },
      { key: 'ctaLabel', label: 'CTA label', kind: 'text', maxLength: 60 },
      { key: 'ctaHref', label: 'CTA link', kind: 'href', maxLength: 200 },
    ],
  },
  {
    id: 'services',
    itemId: '{F40EDF38-1B33-5982-B67F-AC26C7102F2C}',
    title: 'Services',
    blurb: '"Want it even readier?" services strip.',
    group: 'Homepage sections',
    itemPath: '/sitecore/content/brands/new-brand/Data/Home Services',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: 60, required: true },
      { key: 'note', label: 'Note', kind: 'text', maxLength: 120 },
      { key: 'linkLabel', label: 'Link label', kind: 'text', maxLength: 60 },
      { key: 'linkHref', label: 'Link target', kind: 'href', maxLength: 200 },
    ],
  },
];

export function getSection(id: string): SectionDefinition | undefined {
  return SECTION_DEFINITIONS.find((s) => s.id === id);
}

/** Validate one section's values against its field definitions. */
export function validateSection(
  section: SectionDefinition,
  values: SectionValues,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of section.fields) {
    const raw = values[field.key] ?? '';
    const value = raw.trim();
    if (field.required && value.length === 0) {
      errors.push({ fieldKey: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (raw.length > field.maxLength) {
      errors.push({
        fieldKey: field.key,
        message: `${field.label} must be ${field.maxLength} characters or fewer.`,
      });
      continue;
    }
    if (field.kind === 'href' && value.length > 0) {
      const ok =
        value.startsWith('#') ||
        value.startsWith('/') ||
        value.startsWith('https://') ||
        value.startsWith('http://');
      if (!ok) {
        errors.push({
          fieldKey: field.key,
          message: `${field.label} must start with #, /, http:// or https://.`,
        });
      }
    }
  }
  return errors;
}

/** True when two value maps differ for any field defined on the section. */
export function isSectionDirty(
  section: SectionDefinition,
  a: SectionValues,
  b: SectionValues,
): boolean {
  return section.fields.some((f) => (a[f.key] ?? '') !== (b[f.key] ?? ''));
}
