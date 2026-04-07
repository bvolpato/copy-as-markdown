/**
 * Polymarket extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Polymarket',
  matches: [
    '*://polymarket.com/event/*',
    '*://www.polymarket.com/event/*',
  ],
  anchor: {
    selector: 'main header, [class*="EventHeader"], h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const title = document.querySelector('h1')?.textContent?.trim() || Utils.getPageTitle();
    const metadata = { source: 'Polymarket', title, url, extracted_at: new Date().toISOString() };
    const parts: string[] = [`# ${title}\n`];

    // Description
    const descEl =
      document.querySelector('[data-testid="event-description"]') ||
      document.querySelector('.event-description');
    let description = descEl?.textContent?.trim() || '';
    if (!description) {
      const blocks = Array.from(document.querySelectorAll('p'))
        .map((p) => p.textContent!.trim())
        .filter((t) => t.length > 50);
      if (blocks.length) description = blocks[0];
    }
    if (description) { parts.push('## Description\n', description, ''); }

    // Outcomes
    const outcomeEls = document.querySelectorAll('[data-testid="outcome-card"], .outcome-row');
    const yesNoRe = /(\d+(?:\.\d+)?)[%¢]/;

    if (outcomeEls.length > 0) {
      parts.push('## Outcomes\n', '| Outcome | Probability |', '| --- | --- |');
      outcomeEls.forEach((el) => {
        const name = el.querySelector('.outcome-name, [data-testid="outcome-name"]')?.textContent?.trim() || el.querySelector('span')?.textContent?.trim() || '';
        const prob = el.querySelector('.outcome-percent')?.textContent?.trim() || el.textContent!.match(yesNoRe)?.[0] || '';
        if (name) parts.push(`| ${name} | ${prob} |`);
      });
      parts.push('');
    } else {
      const allText = document.body.innerText;
      const pm = allText.match(/(?:Yes|No)\s*\d+(?:\.\d+)?[%¢]/g);
      if (pm) { parts.push('## Odds\n'); pm.forEach((m) => parts.push(`- ${m}`)); parts.push(''); }
    }

    // Volume
    const vm = document.body.innerText.match(/\$[\d,.]+[KMB]?\s*(?:Vol|Volume|Bet)/i);
    if (vm) parts.push(`**Volume:** ${vm[0]}\n`);

    // Resolution rules
    const rulesEl = document.querySelector('.resolution-source, .market-rules');
    if (rulesEl) { parts.push('## Resolution Rules\n', rulesEl.textContent!.trim(), ''); }

    // Comments
    const commentEls = document.querySelectorAll('.comment, [data-testid="comment"]');
    if (commentEls.length > 0) {
      parts.push('## Comments\n');
      let c = 0;
      commentEls.forEach((comment) => {
        if (c >= 15) return;
        const a = comment.querySelector('.author')?.textContent?.trim() || 'User';
        const b = comment.querySelector('.body')?.textContent?.trim() || '';
        if (b) { parts.push(`**${a}**: ${b}\n`); c++; }
      });
    }

    // Fallback broad sweep
    const mainContent = document.querySelector('main, [role="main"], #__next');
    if (mainContent && parts.length < 5) {
      const cleaned = Utils.removeNoise(mainContent, [...Utils.NOISE_SELECTORS, 'header', 'nav']);
      parts.push('## Page Content\n', Markdown.elementToMarkdown(cleaned));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
