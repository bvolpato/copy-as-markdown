/**
 * Extractor registry.
 * Maps URL patterns to site-specific extractors.
 */

import { Extractor, ExtractorConfig } from './types';

const extractors: Extractor[] = [];
const patternRegexCache = new Map<string, RegExp>();
const compiledExtractorPatterns = new WeakMap<Extractor, RegExp[]>();
const hostExactBuckets = new Map<string, number[]>();
const hostSuffixBuckets = new Map<string, number[]>();
const wildcardIndices: number[] = [];

function addBucket(map: Map<string, number[]>, key: string, index: number): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  if (bucket[bucket.length - 1] !== index) bucket.push(index);
}

function indexExtractor(extractor: Extractor, index: number): void {
  if (extractor.regex || extractor.variants) {
    wildcardIndices.push(index);
    return;
  }
  if (extractor.matches.length === 0) return;

  for (const pattern of extractor.matches) {
    const match = pattern.match(/^(?:\*|https?|file):\/\/([^/]*)\//);
    if (!match) {
      wildcardIndices.push(index);
      continue;
    }
    const hostname = match[1].replace(/:\d+$|:\*$/, '').toLowerCase();
    if (!hostname || hostname === '*' || hostname.slice(2).includes('*')) {
      wildcardIndices.push(index);
    } else if (hostname.startsWith('*.')) {
      addBucket(hostSuffixBuckets, hostname.slice(2), index);
    } else if (hostname.includes('*')) {
      wildcardIndices.push(index);
    } else {
      addBucket(hostExactBuckets, hostname, index);
    }
  }
}

function candidateIndicesForUrl(href: string): number[] | null {
  let hostname: string;
  try {
    hostname = new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname) return null;

  const matched = new Set<number>(wildcardIndices);
  const exact = hostExactBuckets.get(hostname);
  if (exact) {
    for (const index of exact) matched.add(index);
  }

  let cursor = hostname;
  while (cursor) {
    const suffix = hostSuffixBuckets.get(cursor);
    if (suffix) {
      for (const index of suffix) matched.add(index);
    }
    const dot = cursor.indexOf('.');
    if (dot < 0) break;
    cursor = cursor.slice(dot + 1);
  }

  if (matched.size === 0) return [];
  return [...matched].sort((left, right) => left - right);
}

function getCompiledPatterns(extractor: Extractor): RegExp[] {
  let compiled = compiledExtractorPatterns.get(extractor);
  if (!compiled) {
    compiled = extractor.matches.map((pattern) => matchPatternToRegex(pattern));
    compiledExtractorPatterns.set(extractor, compiled);
  }
  return compiled;
}

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
  const index = extractors.length;
  extractors.push(extractor);
  indexExtractor(extractor, index);
  return extractor;
}

export function findExtractor(url?: string): Extractor | null {
  const href = url || window.location.href;
  const candidates = candidateIndicesForUrl(href);
  if (candidates !== null) {
    for (const index of candidates) {
      const ext = extractors[index];
      if (matchesExtractor(ext, href)) return ext;
    }
    return null;
  }
  for (const ext of extractors) {
    if (matchesExtractor(ext, href)) return ext;
  }
  return null;
}

export function findExtensionPageButtonCandidate(url?: string): Extractor | null {
  const href = url || window.location.href;
  const candidates = candidateIndicesForUrl(href);
  if (candidates !== null) {
    for (const index of candidates) {
      const ext = extractors[index];
      if (ext.extensionPageButton && matchesExtractorUrl(ext, href)) return ext;
    }
    return null;
  }
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
  const cached = patternRegexCache.get(pattern);
  if (cached) return cached;

  const match = pattern.match(/^(\*|https?|file):\/\/([^/]*)(\/.*)$/);
  if (!match) {
    const never = /$a/;
    patternRegexCache.set(pattern, never);
    return never;
  }
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
  const compiled = new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${host}${port}${pathname}$`);
  patternRegexCache.set(pattern, compiled);
  return compiled;
}

function testRegex(regex: RegExp | null, value: string): boolean {
  if (!regex) return false;
  regex.lastIndex = 0;
  return regex.test(value);
}

export function matchesExtractorUrl(extractor: Extractor, href: string): boolean {
  if (extractor.variants) {
    return extractor.variants.some((variant) => matchesExtractorUrl(variant, href));
  }
  return testRegex(extractor.regex, href) ||
    getCompiledPatterns(extractor).some((compiled) => compiled.test(href));
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
  if (extractor.variants) {
    return extractor.variants.some((variant) => matchesExtractor(variant, href));
  }
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
