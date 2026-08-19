/**
 * Extractor registry.
 * Maps URL patterns to site-specific extractors.
 */

import { Extractor, ExtractorConfig } from './types';

const extractors: Extractor[] = [];

export function defineExtractor(config: ExtractorConfig): Extractor {
  return {
    name: config.name,
    matches: config.matches || [],
    regex: config.regex || null,
    pathnameRegex: config.pathnameRegex || null,
    detect: config.detect || null,
    options: config.options || [],
    extract: config.extract,
    buttonPlacement: config.buttonPlacement || 'floating',
    extensionPageButton: config.extensionPageButton || false,
    anchor: config.anchor || null,
  };
}

export function register(config: ExtractorConfig): Extractor {
  const extractor = defineExtractor(config);
  extractors.push(extractor);
  return extractor;
}

export function findExtractor(url?: string): Extractor | null {
  const href = url || window.location.href;
  for (const ext of extractors) {
    if (matchesExtractor(ext, href)) return ext;
  }
  return null;
}

export function findExtensionPageButtonCandidate(url?: string): Extractor | null {
  const href = url || window.location.href;
  return extractors.find((ext) =>
    ext.extensionPageButton && matchesExtractorUrl(ext, href),
  ) || null;
}

export function findDetectedExtractor(contextDocument?: Document): Extractor | null {
  for (const ext of extractors) {
    if (ext.detect?.(contextDocument)) return ext;
  }
  return null;
}

export function getAll(): Extractor[] {
  return [...extractors];
}

export function matchPatternToRegex(pattern: string): RegExp {
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

function testRegex(regex: RegExp | null, value: string): boolean {
  if (!regex) return false;
  regex.lastIndex = 0;
  return regex.test(value);
}

export function matchesExtractorUrl(extractor: Extractor, href: string): boolean {
  return testRegex(extractor.regex, href) ||
    extractor.matches.some((pattern) => matchPatternToRegex(pattern).test(href));
}

export function matchesPathname(regex: RegExp | null, href: string): boolean {
  if (!regex) return true;
  try {
    regex.lastIndex = 0;
    return regex.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

export function matchesExtractor(extractor: Extractor, href: string): boolean {
  return matchesExtractorUrl(extractor, href)
    && matchesPathname(extractor.pathnameRegex, href);
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
