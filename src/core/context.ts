import { PageMetadata } from './types';

export type LimitedCollection<T> = {
  items: T[];
  total: number;
  truncated: boolean;
};

// Keep legacy result shapes while preserving complete extracted content.
export function limitCollection<T>(
  values: Iterable<T>,
  _maxItems?: number,
): LimitedCollection<T> {
  const all = Array.from(values);
  return {
    items: all,
    total: all.length,
    truncated: false,
  };
}

export function limitMarkdown(
  markdown: string,
  _maxChars?: number,
): { markdown: string; truncated: boolean } {
  return { markdown, truncated: false };
}

export function addExtractionMetadata(
  metadata: PageMetadata,
  details: {
    contentSource: string;
    total?: number;
    included?: number;
    truncated?: boolean;
    complete?: boolean;
  },
): void {
  metadata.content_source = details.contentSource;
  if (details.total !== undefined) metadata.items_total = details.total;
  if (details.included !== undefined) metadata.items_included = details.included;

  const truncated = details.truncated ?? (
    details.total !== undefined
    && details.included !== undefined
    && details.included < details.total
  );
  metadata.truncated = String(truncated);
  metadata.complete = String(details.complete ?? !truncated);
}
