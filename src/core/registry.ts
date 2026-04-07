/**
 * Extractor registry.
 * Maps URL patterns to site-specific extractors.
 */

import { Extractor, ExtractorConfig } from './types';

const extractors: Extractor[] = [];

export function register(config: ExtractorConfig): void {
  extractors.push({
    name: config.name,
    matches: config.matches || [],
    regex: config.regex || null,
    extract: config.extract,
    anchor: config.anchor || null,
  });
}

export function findExtractor(url?: string): Extractor | null {
  const href = url || window.location.href;
  for (const ext of extractors) {
    if (ext.regex && ext.regex.test(href)) return ext;
    for (const pattern of ext.matches) {
      if (matchPatternToRegex(pattern).test(href)) return ext;
    }
  }
  return null;
}

export function getAll(): Extractor[] {
  return [...extractors];
}

function matchPatternToRegex(pattern: string): RegExp {
  // 1. Replace * wildcards with a placeholder that won't be touched by escaping
  const WILDCARD = '\x00';
  let regex = pattern.replace(/\*/g, WILDCARD);
  // 2. Escape regex special characters
  regex = regex.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // 3. Replace placeholders with .* (regex wildcard)
  regex = regex.replace(new RegExp(WILDCARD, 'g'), '.*');
  // 4. Convert scheme wildcard .*:// to proper group
  regex = regex.replace(/^\.\*:\/\//, '(https?|file)://');
  return new RegExp('^' + regex + '$');
}

export function getAllMatchPatterns(): string[] {
  const patterns = new Set<string>();
  for (const ext of extractors) {
    for (const pattern of ext.matches) {
      patterns.add(pattern);
    }
  }
  return [...patterns];
}
