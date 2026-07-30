import { PageMetadata } from './types';

export const DEFAULT_ITEM_LIMIT = 200;
export const DEFAULT_MARKDOWN_LIMIT = 120_000;

export type LimitedCollection<T> = {
  items: T[];
  total: number;
  truncated: boolean;
};

export function limitCollection<T>(
  values: Iterable<T>,
  maxItems = DEFAULT_ITEM_LIMIT,
): LimitedCollection<T> {
  const all = Array.from(values);
  return {
    items: all.slice(0, Math.max(0, maxItems)),
    total: all.length,
    truncated: all.length > maxItems,
  };
}

export function limitMarkdown(
  markdown: string,
  maxChars = DEFAULT_MARKDOWN_LIMIT,
): { markdown: string; truncated: boolean } {
  if (markdown.length <= maxChars) return { markdown, truncated: false };

  const marker = '\n\n*[Content truncated for agent context.]*';
  const boundary = Math.max(0, maxChars - marker.length);
  const candidate = markdown.slice(0, boundary);
  const lastBreak = candidate.lastIndexOf('\n');
  const body = candidate.slice(0, lastBreak > boundary * 0.8 ? lastBreak : boundary).trimEnd();
  return { markdown: `${body}${marker}`, truncated: true };
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
