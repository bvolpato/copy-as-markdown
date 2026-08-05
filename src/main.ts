/**
 * Copy as Markdown — Main entry point.
 *
 * Imports all extractors (which self-register), then finds
 * the matching one for the current page and shows the button.
 */

import { findExtractor, findExtensionPageButtonCandidate } from './core/registry';
import { showButton, hideButton, copyToClipboard, showToast, isHostDismissed, chooseExtractionOption } from './core/ui';
import type { Extractor } from './core/types';
import { buildPageMarkdown, elementToMarkdown } from './core/markdown';
import { addExtractionMetadata, limitMarkdown } from './core/context';

// Import extractors — each auto-registers on import
import './extractors/wikipedia';
import './extractors/grokipedia';
import './extractors/google-search';
import './extractors/google-docs';
import './extractors/google-sheets';
import './extractors/google-slides';
import './extractors/gmail';
import './extractors/notion';
import './extractors/microsoft-office';
import './extractors/bing';
import './extractors/reddit';
import './extractors/youtube';
import './extractors/whatsapp';
import './extractors/slack';
import './extractors/discord';
import './extractors/polymarket';
import './extractors/grok';
import './extractors/x-twitter';
import './extractors/facebook';
import './extractors/instagram';
import './extractors/tiktok';
import './extractors/news';
import './extractors/github';
import './extractors/gitlab';
import './extractors/bitbucket';
import './extractors/stackoverflow';
import './extractors/hackernews';
import './extractors/linkedin';
import './extractors/jira';
import './extractors/confluence';
import './extractors/amazon';
import './extractors/arxiv';
import './extractors/medium';
import './extractors/devto';
import './extractors/mdn';
import './extractors/substack';
import './extractors/chatgpt';
import './extractors/claude';
import './extractors/gemini';
import './extractors/perplexity';
import './extractors/npm';
import './extractors/pypi';
import './extractors/datadog-dashboard';
import './extractors/datadog-notebook';

declare const __IS_USERSCRIPT__: boolean;

const PAGE_BUTTON_OPTOUT_ID = 'copy_as_markdown_btn';

(function () {
  if ((window as any).__copyAsMarkdownInit) return;
  (window as any).__copyAsMarkdownInit = true;

  let toolbarListenerAttached = false;

  function getExtractor() {
    let extractor = findExtractor(window.location.href);

    if (!extractor) {
      // Fallback best-effort extractor for unlisted pages
      extractor = {
        name: 'Fallback',
        anchor: null,
        options: [],
        extract: async () => {
          // If the user has highlighted text, extract just that
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0 && selection.toString().trim() !== '') {
            const container = document.createElement('div');
            for (let i = 0; i < selection.rangeCount; i++) {
              container.appendChild(selection.getRangeAt(i).cloneContents());
            }
            const metadata = {
              source: 'Fallback',
              title: document.title,
              url: window.location.href,
              scope: 'selection',
            };
            const limited = limitMarkdown(elementToMarkdown(container));
            addExtractionMetadata(metadata, {
              contentSource: 'selected page content',
              truncated: limited.truncated,
              complete: !limited.truncated,
            });
            return buildPageMarkdown(metadata, limited.markdown);
          }

          // Otherwise, find the richest content container on the page
          const contentEl = document.querySelector('article, main, [role="main"]') || document.body;
          const metadata = {
            source: 'Fallback',
            title: document.title,
            url: window.location.href,
            scope: 'detected main content',
          };
          const limited = limitMarkdown(elementToMarkdown(contentEl));
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
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

      const registeredExtractor = findExtractor(window.location.href);
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
      showButton(() => extractWithOptions(extractor), anchor);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncPageButton);
    } else {
      setTimeout(syncPageButton, 500);
    }

    // Re-detect on SPA navigation and page-owned opt-out changes.
    let lastUrl = window.location.href;
    let lastPageButtonOptOut = hasPageButtonOptOut();
    const observer = new MutationObserver(() => {
      const currentUrl = window.location.href;
      const pageButtonOptOut = hasPageButtonOptOut();
      if (currentUrl !== lastUrl || pageButtonOptOut !== lastPageButtonOptOut) {
        lastUrl = currentUrl;
        lastPageButtonOptOut = pageButtonOptOut;
        if (pageButtonOptOut) {
          hideButton();
          return;
        }
        setTimeout(syncPageButton, 800);
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
