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
  const match = pattern.match(/^(\*|https?|file):\/\/([^/]*)(\/.*)$/);
  if (!match) return /$a/;
  const [, scheme, authority, path] = match;
  const escape = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const portMatch = authority.match(/^(.*?)(:\d+|:\*)?$/)!;
  const hostname = portMatch[1];
  const host = hostname === '*'
    ? '[^/?#:@]+'
    : hostname.startsWith('*.')
      ? `(?:[^/?#:@]+\\.)?${escape(hostname.slice(2))}`
      : escape(hostname);
  const port = scheme === 'file' ? '' : portMatch[2] && portMatch[2] !== ':*'
    ? escape(portMatch[2]) : '(?::\\d+)?';
  const pathname = path.split('*').map(escape).join('.*');
  return new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${host}${port}${pathname}$`);
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
