/**
 * Shared utility functions for extractors.
 */

/**
 * Wait for an element to appear in the DOM (useful for SPAs).
 */
export function waitForElement(
  selector: string,
  timeout = 10000,
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const root = document.body || document.documentElement;
    let settled = false;
    const observer = new MutationObserver(() => {
      if (settled) return;
      const found = document.querySelector(selector);
      if (found) {
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(found);
      }
    });

    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      reject(new Error(`Timeout waiting for: ${selector}`));
    }, timeout);
  });
}

/**
 * Get the page's canonical URL or current URL.
 */
export function getCanonicalUrl(): string {
  const canonical = document.querySelector(
    'link[rel="canonical"]',
  ) as HTMLLinkElement | null;
  if (canonical && canonical.href) return canonical.href;
  return window.location.href;
}

/**
 * Extract Open Graph or standard meta tag content.
 */
export function getMeta(name: string): string {
  const selectors = [
    `meta[property="og:${name}"]`,
    `meta[name="${name}"]`,
    `meta[property="${name}"]`,
    `meta[name="twitter:${name}"]`,
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLMetaElement | null;
    if (el && el.content) return el.content.trim();
  }
  return '';
}

/**
 * Get the page title cleaned up.
 */
export function getPageTitle(): string {
  return getMeta('title') || document.title || '';
}

/**
 * Remove elements matching selectors from a cloned node.
 */
export function removeNoise(
  element: Element,
  selectors: string[],
): Element {
  const clone = element.cloneNode(true) as Element;
  selectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => {
      if (sel === 'footer' && el.closest('blockquote')) return;
      if (sel === 'header' && isSectionHeading(el)) return;
      el.remove();
    });
  });
  return clone;
}

/** A section header with a subheading is content. Page and article headers are not. */
function isSectionHeading(header: Element): boolean {
  return header.parentElement?.tagName === 'SECTION'
    && header.querySelector('h2, h3, h4, h5, h6') !== null
    && header.querySelector('h1, nav') === null;
}

/** Standard noise selectors to strip from content. */
export const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'footer', 'header',
  '.ad', '.ads', '.advertisement', '.social-share',
  '.cookie-banner', '.cookie-consent',
  '.popup', '.modal', '.overlay',
  '.sidebar', '.related', '.recommended',
  '.newsletter', '.subscribe',
  '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
  '[aria-hidden="true"]',
];

/**
 * Format a number with commas.
 */
export function formatNumber(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '';
  return Number(num).toLocaleString();
}

/**
 * Format a date string to a readable format.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr.trim();
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      // JavaScript reads a date without a time as UTC. Do not shift it to another day.
      timeZone: /^\d{4}(?:-\d{2}){0,2}$/.test(dateStr.trim()) ? 'UTC' : undefined,
    });
  } catch {
    return dateStr;
  }
}

/**
 * Perform a fetch request with a bounded timeout.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  if (init.signal || typeof AbortController === 'undefined') {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Iterative minimum for arbitrarily large numeric arrays without spread stack limits.
 */
export function safeMin(values: readonly number[]): number {
  let min = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] < min) min = values[i];
  }
  return min;
}

/**
 * Iterative maximum for arbitrarily large numeric arrays without spread stack limits.
 */
export function safeMax(values: readonly number[]): number {
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

/**
 * Create a per-extraction memoized visibility checker to avoid repeated ancestor getComputedStyle walks.
 */
export function createVisibilityChecker(): (element: Element | null) => boolean {
  const cache = new WeakMap<Element, boolean>();

  function check(element: Element | null): boolean {
    if (!element) return false;
    const cached = cache.get(element);
    if (cached !== undefined) return cached;

    if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden')) {
      cache.set(element, false);
      return false;
    }

    const htmlEl = element as HTMLElement;
    const inlineStyle = htmlEl.style;
    if (
      inlineStyle
      && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden' || inlineStyle.visibility === 'collapse')
    ) {
      cache.set(element, false);
      return false;
    }

    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle(element);
    if (
      style
      && (
        style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse'
        || style.opacity === '0'
        || style.contentVisibility === 'hidden'
      )
    ) {
      cache.set(element, false);
      return false;
    }

    const parent = element.parentElement;
    if (parent instanceof HTMLSlotElement && parent.assignedNodes({ flatten: true }).length > 0) {
      cache.set(element, false);
      return false;
    }
    if (parent?.shadowRoot && !element.assignedSlot) {
      cache.set(element, false);
      return false;
    }

    const nextParent = element.assignedSlot
      || parent
      || (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);

    const visible = nextParent ? check(nextParent) : true;
    cache.set(element, visible);
    return visible;
  }

  return check;
}

/**
 * Truncate text to maxLen characters with ellipsis.
 */
export function truncate(text: string, maxLen = 200): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

/**
 * Detect if page has a paywall overlay.
 */
export function hasPaywall(): boolean {
  const paywallSelectors = [
    '.paywall', '.subscription-wall', '.meter-wall',
    '[class*="paywall"]', '[class*="Paywall"]',
    '[id*="paywall"]', '[id*="Paywall"]',
    '.tp-modal', '.piano-offer',
    '.article-gate', '.gate-content',
  ];
  return paywallSelectors.some(
    (sel) => document.querySelector(sel) !== null,
  );
}
