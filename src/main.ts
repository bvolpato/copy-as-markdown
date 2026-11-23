/**
 * Copy as Markdown — Main entry point.
 *
 * Imports all extractors (which self-register), then finds
 * the matching one for the current page and shows the button.
 */

import { findDetectedExtractor, findExtractor, findExtensionPageButtonCandidate } from './core/registry';
import { showButton, hideButton, copyToClipboard, showToast, isHostDismissed, chooseExtractionOption } from './core/ui';
import type { Extractor, PageMetadata } from './core/types';
import { buildPageMarkdown, elementToMarkdown } from './core/markdown';
import { addExtractionMetadata, limitMarkdown } from './core/context';
import * as Utils from './core/utils';
import './catalog';

declare const __IS_USERSCRIPT__: boolean;

const PAGE_BUTTON_OPTOUT_ID = 'copy_as_markdown_btn';

type SchemaInfo = {
  title?: string;
  author?: string;
  datePublished?: string;
  description?: string;
  price?: string;
  rating?: string;
};

function readSchemaInfo(): SchemaInfo {
  const info: SchemaInfo = {};
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw || raw.length > 500_000) continue;
    try {
      const parsed = JSON.parse(raw);
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
        const typeRaw = record['@type'];
        const types = Array.isArray(typeRaw) ? typeRaw : [typeRaw];
        const isInteresting = types.some((t) =>
          typeof t === 'string'
          && /^(?:Article|NewsArticle|BlogPosting|TechArticle|Product|Recipe|FAQPage|JobPosting|HowTo|WebPage)$/i.test(t),
        );
        if (!isInteresting) continue;
        if (!info.title && typeof record.headline === 'string') info.title = record.headline.trim();
        if (!info.title && typeof record.name === 'string') info.title = record.name.trim();
        if (!info.description && typeof record.description === 'string') info.description = record.description.trim();
        if (!info.datePublished && typeof record.datePublished === 'string') info.datePublished = record.datePublished.trim();
        if (!info.author && record.author) {
          const authorObj = Array.isArray(record.author) ? record.author[0] : record.author;
          if (typeof authorObj === 'string') info.author = authorObj.trim();
          else if (authorObj && typeof authorObj === 'object' && typeof (authorObj as Record<string, unknown>).name === 'string') {
            info.author = ((authorObj as Record<string, unknown>).name as string).trim();
          }
        }
        if (!info.price && record.offers && typeof record.offers === 'object') {
          const offer = (Array.isArray(record.offers) ? record.offers[0] : record.offers) as Record<string, unknown> | undefined;
          if (offer?.price !== undefined) {
            const currency = typeof offer.priceCurrency === 'string' ? `${offer.priceCurrency} ` : '';
            info.price = `${currency}${offer.price}`.trim();
          }
        }
        if (!info.rating && record.aggregateRating && typeof record.aggregateRating === 'object') {
          const rating = record.aggregateRating as Record<string, unknown>;
          if (rating.ratingValue !== undefined) {
            const count = rating.reviewCount || rating.ratingCount;
            info.rating = count ? `${rating.ratingValue}/5 (${count} reviews)` : String(rating.ratingValue);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return info;
}

function findBestFallbackContent(): Element {
  const semantic = document.querySelector('article, main, [role="main"]');
  if (semantic && (semantic.textContent || '').trim().length >= 200) {
    return semantic;
  }

  // Readability-style lightweight candidate scoring when no rich <article>/<main> exists.
  const candidates = Array.from(document.querySelectorAll('article, main, [role="main"], section, div'));
  let best: Element | null = semantic;
  let bestScore = semantic ? scoreFallbackCandidate(semantic) : 0;

  for (const el of candidates) {
    if (el.matches('nav, header, footer, aside') || el.closest('[data-cam-instance]')) continue;
    const textLen = (el.textContent || '').trim().length;
    if (textLen < 160) continue;
    const score = scoreFallbackCandidate(el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best || document.body;
}

function scoreFallbackCandidate(el: Element): number {
  const paragraphs = el.querySelectorAll('p, pre, li');
  let textChars = 0;
  let linkChars = 0;
  for (const p of paragraphs) {
    const len = (p.textContent || '').trim().length;
    if (len >= 25) textChars += len;
  }
  for (const a of el.querySelectorAll('a')) {
    linkChars += (a.textContent || '').trim().length;
  }
  const totalLen = Math.max(1, (el.textContent || '').trim().length);
  const linkDensity = linkChars / totalLen;
  let score = textChars * (1 - Math.min(0.85, linkDensity));
  const idClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
  if (/(?:article|content|post|entry|story|body|prose|markdown)/i.test(idClass)) score *= 1.25;
  if (/(?:nav|menu|sidebar|footer|header|comment|banner|cookie|modal|popup|related)/i.test(idClass)) score *= 0.25;
  return score;
}

function extractSelectionMarkdown(sourceName: string): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  if (!selection.toString().trim()) return null;

  const container = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    container.appendChild(range.cloneContents());
  }
  const body = elementToMarkdown(container);
  if (!body) return null;

  const metadata: PageMetadata = {
    source: sourceName,
    title: document.title,
    url: window.location.href,
    scope: 'selection',
  };
  const limited = limitMarkdown(body);
  addExtractionMetadata(metadata, {
    contentSource: 'selected page content',
    truncated: limited.truncated,
    complete: !limited.truncated,
  });
  return buildPageMarkdown(metadata, limited.markdown);
}

(function () {
  if ((window as any).__copyAsMarkdownInit) return;
  (window as any).__copyAsMarkdownInit = true;

  let toolbarListenerAttached = false;

  function getExtractor() {
    let extractor = findExtractor(window.location.href) || findDetectedExtractor();

    if (!extractor) {
      // Fallback best-effort extractor for unlisted pages
      extractor = {
        name: 'Fallback',
        anchor: null,
        options: [],
        extract: async () => {
          const selected = extractSelectionMarkdown('Fallback');
          if (selected) return selected;

          // Otherwise, find the richest content container on the page
          const contentEl = findBestFallbackContent();
          const cleaned = contentEl === document.body
            ? Utils.removeNoise(contentEl, Utils.NOISE_SELECTORS)
            : contentEl;
          const schema = readSchemaInfo();
          const metadata: PageMetadata = {
            source: 'Fallback',
            title: schema.title || document.title,
            url: window.location.href,
            author: schema.author,
            published: schema.datePublished ? Utils.formatDate(schema.datePublished) : undefined,
            price: schema.price,
            rating: schema.rating,
            scope: 'detected main content',
          };
          const limited = limitMarkdown(elementToMarkdown(cleaned));
          addExtractionMetadata(metadata, {
            contentSource: 'live page DOM',
            truncated: limited.truncated,
            complete: false,
          });
          return buildPageMarkdown(metadata, limited.markdown);
        }
      } as any;
    } else {
      console.log(`[Copy as Markdown] Active extractor: ${extractor.name}`);
    }

    return extractor;
  }

  async function extractWithOptions(extractor: Extractor): Promise<string | null> {
    const selected = extractSelectionMarkdown(extractor.name);
    if (selected) return selected;

    let optionId: string | undefined;
    if (extractor.options.length > 0) {
      optionId = await chooseExtractionOption(`Copy ${extractor.name}`, extractor.options) || undefined;
      if (!optionId) return null;
    }
    return extractor.extract(optionId);
  }

  async function performCopy(): Promise<boolean> {
    try {
      const extractor = getExtractor() as Extractor;
      const markdown = await extractWithOptions(extractor);
      if (!markdown) return false;
      await copyToClipboard(markdown);
      showToast('✅ Copied as Markdown!');
      return true;
    } catch (error) {
      console.error('[Copy as Markdown] Copy failed', error);
      showToast('❌ Copy failed. Check clipboard permissions.');
      throw error;
    }
  }

  // Listen for Extension Toolbar Icon clicks (synchronous registration)
  if (!toolbarListenerAttached && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    toolbarListenerAttached = true;
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'copy-as-markdown') {
        performCopy().then(
          (copied) => sendResponse({ success: true, copied }),
          (error) => sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return true;
      }
    });
  }

  // Userscripts show page UI everywhere. Extension builds opt in narrowly.
  const isUserscript = typeof __IS_USERSCRIPT__ !== 'undefined' && __IS_USERSCRIPT__;
  const shouldMonitorPageUi =
    (isUserscript || !!findExtensionPageButtonCandidate(window.location.href));
  if (shouldMonitorPageUi && window.self === window.top) {
    function hasPageButtonOptOut(): boolean {
      return !!document.getElementById(PAGE_BUTTON_OPTOUT_ID);
    }

    function syncPageButton(): void {
      if (hasPageButtonOptOut()) {
        hideButton();
        return;
      }

      const registeredExtractor = findExtractor(window.location.href) || findDetectedExtractor();
      if (!isUserscript && !registeredExtractor?.extensionPageButton) {
        hideButton();
        return;
      }
      if (isHostDismissed()) {
        hideButton();
        return;
      }

      const extractor = registeredExtractor || getExtractor()!;
      const anchor = extractor.buttonPlacement === 'anchor' ? extractor.anchor : null;
      const button = showButton(() => extractWithOptions(extractor), anchor);
      if (button) button.dataset.camExtractor = extractor.name;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncPageButton);
    } else {
      setTimeout(syncPageButton, 500);
    }

    // Re-detect on SPA navigation and page-owned opt-out changes (debounced to avoid mutation storms).
    let lastUrl = window.location.href;
    let lastPageButtonOptOut = hasPageButtonOptOut();
    let lastExtractorName = (findExtractor(lastUrl) || findDetectedExtractor())?.name || '';
    let checkTimer: number | null = null;
    let syncTimer: number | null = null;

    function runCheck(): void {
      checkTimer = null;
      const currentUrl = window.location.href;
      const pageButtonOptOut = hasPageButtonOptOut();
      const urlChanged = currentUrl !== lastUrl;
      const optOutChanged = pageButtonOptOut !== lastPageButtonOptOut;

      if (pageButtonOptOut && optOutChanged) {
        lastUrl = currentUrl;
        lastPageButtonOptOut = true;
        if (syncTimer !== null) {
          window.clearTimeout(syncTimer);
          syncTimer = null;
        }
        hideButton();
        return;
      }

      const urlExtractor = findExtractor(currentUrl);
      const extractorName = (urlExtractor || findDetectedExtractor())?.name || '';
      if (urlChanged || optOutChanged || extractorName !== lastExtractorName) {
        lastUrl = currentUrl;
        lastPageButtonOptOut = pageButtonOptOut;
        lastExtractorName = extractorName;
        if (pageButtonOptOut) {
          hideButton();
          return;
        }
        if (syncTimer !== null) window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(() => {
          syncTimer = null;
          syncPageButton();
        }, 800);
      }
    }

    function scheduleCheck(immediate = false): void {
      if (immediate) {
        if (checkTimer !== null) {
          window.clearTimeout(checkTimer);
          checkTimer = null;
        }
        runCheck();
        return;
      }
      if (checkTimer !== null) return;
      checkTimer = window.setTimeout(runCheck, 200);
    }

    window.addEventListener('popstate', () => scheduleCheck(true));
    window.addEventListener('hashchange', () => scheduleCheck(true));
    const navApi = (window as unknown as { navigation?: EventTarget }).navigation;
    navApi?.addEventListener?.('navigatesuccess', () => scheduleCheck(true));

    const observer = new MutationObserver((records) => {
      // Fast-path: immediate hide if page-owned opt-out marker was inserted.
      if (hasPageButtonOptOut() !== lastPageButtonOptOut) {
        scheduleCheck(true);
        return;
      }
      const hasExternalMutation = records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest('[data-cam-instance]');
      });
      if (hasExternalMutation) scheduleCheck(false);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
