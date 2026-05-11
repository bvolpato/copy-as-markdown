/**
 * Copy as Markdown — Main entry point.
 *
 * Imports all extractors (which self-register), then finds
 * the matching one for the current page and shows the button.
 */

import { findExtractor } from './core/registry';
import { showButton, copyToClipboard, showToast } from './core/ui';
import { buildPageMarkdown, elementToMarkdown, htmlToMarkdown } from './core/markdown';

// Import extractors — each auto-registers on import
import './extractors/wikipedia';
import './extractors/grokipedia';
import './extractors/google-search';
import './extractors/google-docs';
import './extractors/bing';
import './extractors/reddit';
import './extractors/youtube';
import './extractors/whatsapp';
import './extractors/polymarket';
import './extractors/x-twitter';
import './extractors/news';
import './extractors/github';
import './extractors/stackoverflow';
import './extractors/hackernews';
import './extractors/linkedin';
import './extractors/amazon';
import './extractors/arxiv';
import './extractors/medium';
import './extractors/devto';
import './extractors/mdn';
import './extractors/substack';
import './extractors/chatgpt';
import './extractors/npm';
import './extractors/pypi';

declare const __IS_USERSCRIPT__: boolean;

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
        extract: async () => {
          // If the user has highlighted text, extract just that
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0 && selection.toString().trim() !== '') {
            const container = document.createElement('div');
            for (let i = 0; i < selection.rangeCount; i++) {
              container.appendChild(selection.getRangeAt(i).cloneContents());
            }
            return buildPageMarkdown({ url: window.location.href }, htmlToMarkdown(container.innerHTML));
          }

          // Otherwise, find the richest content container on the page
          const contentEl = document.querySelector('article, main, [role="main"]') || document.body;
          return buildPageMarkdown(
            { title: document.title, url: window.location.href },
            elementToMarkdown(contentEl)
          );
        }
      } as any;
    } else {
      console.log(`[Copy as Markdown] Active extractor: ${extractor.name}`);
    }
    
    return extractor;
  }

  function performCopy() {
    const extractor = getExtractor();
    Promise.resolve(extractor!.extract())
      .then(md => {
        copyToClipboard(md).then(() => {
          showToast('✅ Copied as Markdown!');
        });
      })
      .catch(err => {
        console.error('[Copy as Markdown] Extraction error', err);
        showToast('❌ Error copying markdown');
      });
  }

  // Listen for Extension Toolbar Icon clicks (synchronous registration)
  if (!toolbarListenerAttached && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    toolbarListenerAttached = true;
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'copy-as-markdown') {
        performCopy();
        sendResponse({ success: true });
      }
    });
  }

  // UI Injection is only for Userscript installations
  if (typeof __IS_USERSCRIPT__ !== 'undefined' && __IS_USERSCRIPT__) {
    function initUserscript(): void {
      const extractor = getExtractor();
      const anchor = extractor!.buttonPlacement === 'anchor' ? extractor!.anchor : null;

      showButton(
        () => extractor!.extract(),
        anchor,
      );
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUserscript);
    } else {
      setTimeout(initUserscript, 500);
    }

    // Re-detect on SPA navigation
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setTimeout(initUserscript, 800);
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
