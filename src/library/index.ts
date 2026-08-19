import {
  defineExtractor,
  getAll,
  matchPatternToRegex,
  matchesExtractor,
} from '../core/registry';
import {
  buildPageMarkdown,
  cleanMarkdown,
  elementToMarkdown,
  htmlToMarkdown,
  normalizeUnicodeText,
} from '../core/markdown';
import type { Extractor } from '../core/types';

export type { Extractor, ExtractorConfig, ExtractionOption } from '../core/types';
export {
  buildPageMarkdown,
  cleanMarkdown,
  defineExtractor,
  elementToMarkdown,
  htmlToMarkdown,
  normalizeUnicodeText,
};

export type ExtractorSelector = string | Extractor;
export type UrlRestriction = string | RegExp;

export interface MatchInput {
  url?: string | URL;
  document?: Document;
}

export interface MatchContext {
  url: URL;
  document?: Document;
  extractor: Extractor;
}

export interface ExtractorMatcherOptions {
  /** Loaded extractor names or custom extractor objects. Defaults to current registry. */
  extractors?: readonly ExtractorSelector[];
  /** Exact hostnames, or wildcard subdomains such as `*.atlassian.net`. */
  domains?: readonly string[];
  /** Exact URL origins, including scheme and optional port. */
  origins?: readonly string[];
  /** Additional userscript-style URL patterns or regular expressions. */
  urlPatterns?: readonly UrlRestriction[];
  /** Final caller-controlled restriction. Can inspect current DOM. */
  when?: (context: MatchContext) => boolean;
}

export interface ExtractorMatch {
  readonly extractor: Extractor;
  readonly name: string;
  readonly url: URL;
  extract(optionId?: string): Promise<string>;
}

export interface ExtractorMatcher {
  readonly extractors: readonly Extractor[];
  match(input?: MatchInput): ExtractorMatch | null;
  matchAll(input?: MatchInput): readonly ExtractorMatch[];
}

/** Return full registered catalog, or selected extractor names. */
export function getExtractors(names?: readonly string[]): readonly Extractor[] {
  const catalog = getAll();
  if (!names) return Object.freeze(catalog);
  return Object.freeze(resolveExtractors(names, catalog));
}

/** Match configured site extractors without starting extension or userscript UI. */
export function createExtractorMatcher(
  options: ExtractorMatcherOptions = {},
): ExtractorMatcher {
  const catalog = getAll();
  const selected = Object.freeze(resolveExtractors(options.extractors ?? catalog, catalog));
  const domains = normalizeDomains(options.domains ?? []);
  const origins = normalizeOrigins(options.origins ?? []);
  const urlPatterns = options.urlPatterns ?? [];

  function matchAll(input: MatchInput = {}): readonly ExtractorMatch[] {
    const url = resolveUrl(input);
    if (!matchesDomainRestrictions(url, domains)) return [];
    if (origins.length > 0 && !origins.includes(url.origin)) return [];
    if (urlPatterns.length > 0 && !urlPatterns.some((pattern) => matchesUrlRestriction(url, pattern))) {
      return [];
    }

    return selected
      .filter((extractor) => matchesExtractor(extractor, url.href)
        || Boolean(input.document && extractor.detect?.(input.document)))
      .filter((extractor) => options.when?.({
        url,
        document: input.document,
        extractor,
      }) ?? true)
      .map((extractor) => createMatch(extractor, url, input.document));
  }

  return Object.freeze({
    extractors: selected,
    match(input?: MatchInput): ExtractorMatch | null {
      return matchAll(input)[0] ?? null;
    },
    matchAll,
  });
}

/** Convert a Document or Element without invoking any site-specific extractor. */
export function domToMarkdown(root: Document | Element): string {
  const element = root.nodeType === 9
    ? (root as Document).body || (root as Document).documentElement
    : root as Element;
  return elementToMarkdown(element);
}

function createMatch(
  extractor: Extractor,
  url: URL,
  contextDocument?: Document,
): ExtractorMatch {
  return Object.freeze({
    extractor,
    name: extractor.name,
    url,
    async extract(optionId?: string): Promise<string> {
      assertActivePage(url, contextDocument);
      return extractor.extract(optionId);
    },
  });
}

function resolveExtractors(
  selectors: readonly ExtractorSelector[],
  catalog: readonly Extractor[],
): Extractor[] {
  const byName = new Map(catalog.map((extractor) => [normalizeName(extractor.name), extractor]));
  const selected: Extractor[] = [];
  const seen = new Set<Extractor>();

  for (const selector of selectors) {
    const extractor = typeof selector === 'string'
      ? byName.get(normalizeName(selector))
      : selector;
    if (!extractor) {
      throw new Error(`Unknown extractor: ${selector}`);
    }
    if (!seen.has(extractor)) {
      selected.push(extractor);
      seen.add(extractor);
    }
  }
  return selected;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeDomains(values: readonly string[]): string[] {
  return values.map((value) => {
    const domain = value.trim().toLowerCase().replace(/\.$/, '');
    if (!domain || domain.includes('/') || domain.includes(':')) {
      throw new Error(`Invalid domain restriction: ${value}`);
    }
    return domain;
  });
}

function normalizeOrigins(values: readonly string[]): string[] {
  return values.map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      throw new Error(`Invalid origin restriction: ${value}`);
    }
  });
}

function matchesDomainRestrictions(url: URL, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => domain.startsWith('*.')
    ? hostname.endsWith(domain.slice(1)) && hostname !== domain.slice(2)
    : hostname === domain);
}

function matchesUrlRestriction(url: URL, restriction: UrlRestriction): boolean {
  if (typeof restriction === 'string') {
    return matchPatternToRegex(restriction).test(url.href);
  }
  restriction.lastIndex = 0;
  return restriction.test(url.href);
}

function resolveUrl(input: MatchInput): URL {
  if (input.url) return new URL(input.url);
  if (input.document?.location?.href) return new URL(input.document.location.href);
  if (typeof window !== 'undefined') return new URL(window.location.href);
  throw new Error('Matcher requires a URL outside a browser page');
}

function assertActivePage(url: URL, contextDocument?: Document): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('Site extractors require an active browser page');
  }
  if (contextDocument && contextDocument !== document) {
    throw new Error('Site extractors require active page Document; use domToMarkdown for detached DOM');
  }

  const active = new URL(window.location.href);
  if (`${active.origin}${active.pathname}${active.search}` !== `${url.origin}${url.pathname}${url.search}`) {
    throw new Error('Matched URL does not describe active browser page');
  }
}
