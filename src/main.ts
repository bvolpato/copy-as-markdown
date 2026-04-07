/**
 * Copy as Markdown — Main entry point.
 *
 * Imports all extractors (which self-register), then finds
 * the matching one for the current page and shows the button.
 */

import { findExtractor } from './core/registry';
import { showButton } from './core/ui';

// Import extractors — each auto-registers on import
import './extractors/wikipedia';
import './extractors/grokipedia';
import './extractors/google-search';
import './extractors/bing';
import './extractors/reddit';
import './extractors/youtube';
import './extractors/whatsapp';
import './extractors/polymarket';
import './extractors/x-twitter';
import './extractors/news';

(function () {
  if ((window as any).__copyAsMarkdownInit) return;
  (window as any).__copyAsMarkdownInit = true;

  function init(): void {
    const extractor = findExtractor(window.location.href);
    if (!extractor) return;

    console.log(`[Copy as Markdown] Active extractor: ${extractor.name}`);

    showButton(
      () => extractor.extract(),
      extractor.anchor,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

  // Re-detect on SPA navigation
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(init, 800);
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
