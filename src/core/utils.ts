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

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
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
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });
  return clone;
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
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
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
