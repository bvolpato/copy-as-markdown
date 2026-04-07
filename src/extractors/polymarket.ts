/**
 * Polymarket extractor.
 *
 * Polymarket is a Next.js SPA — most structured data lives in JSON-LD
 * script tags and Open Graph meta tags rather than stable DOM selectors.
 * This extractor mines those sources for a rich, complete output.
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
    selector: 'div.flex.items-center:has(.bookmarkButton)',
    position: 'append',
    style: 'icon',
    css: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      padding: '0',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      color: 'inherit',
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
    },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    // ---------- 1. Parse JSON-LD blocks ----------
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    let eventData: any = null;
    let discussionData: any = null;
    let faqData: any = null;
    let breadcrumbData: any = null;

    jsonLdScripts.forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        if (data['@type'] === 'Event') eventData = data;
        else if (data['@type'] === 'DiscussionForumPosting') discussionData = data;
        else if (data['@type'] === 'FAQPage') faqData = data;
        else if (data['@type'] === 'BreadcrumbList') breadcrumbData = data;
      } catch { /* ignore */ }
    });

    // ---------- 2. Extract from Open Graph / meta ----------
    const getMeta = (name: string): string =>
      document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
        ?.getAttribute('content') || '';

    const ogTitle = getMeta('og:title');
    const ogDesc = getMeta('og:description');
    const twitterDesc = getMeta('twitter:description');
    const category = getMeta('og:temporal:event_category');
    const subcategory = getMeta('og:temporal:event_subcategory');
    const status = getMeta('og:temporal:status');

    // ---------- 3. Derive title ----------
    const title = eventData?.name
      || ogTitle
      || document.querySelector('h1')?.textContent?.trim()
      || Utils.getPageTitle();

    // ---------- 4. Metadata ----------
    const metadata: Record<string, string> = {
      source: 'Polymarket',
      title,
      url,
    };
    if (category) metadata.category = category;
    if (subcategory) metadata.subcategory = subcategory;
    if (status) metadata.status = status;
    if (eventData?.startDate) metadata.start_date = eventData.startDate;
    if (eventData?.endDate) metadata.end_date = eventData.endDate;

    // ---------- 5. Build Markdown ----------
    const parts: string[] = [`# ${title}\n`];

    // Category breadcrumb
    if (breadcrumbData?.itemListElement?.length) {
      const crumbs = breadcrumbData.itemListElement
        .map((item: any) => item.name)
        .join(' → ');
      parts.push(`**Category:** ${crumbs}`);
    } else if (category) {
      parts.push(`**Category:** ${category}${subcategory ? ` → ${subcategory}` : ''}`);
    }
    if (status) parts.push(`**Status:** ${status}`);
    if (eventData?.startDate) parts.push(`**Started:** ${new Date(eventData.startDate).toLocaleDateString()}`);
    if (eventData?.endDate) parts.push(`**Resolves:** ${new Date(eventData.endDate).toLocaleDateString()}`);
    parts.push('');

    // Volume (from og:description which often contains "$14.9M traded")
    const volumeMatch = (ogDesc || twitterDesc || '').match(/\$([\d,.]+\s*(?:million|billion|[KMB])?\s*)/i);
    if (volumeMatch) {
      parts.push(`**Volume:** $${volumeMatch[1].trim()}\n`);
    }

    // ---------- 6. Outcomes from FAQ (most reliable source) ----------
    if (faqData?.mainEntity?.length) {
      // The FAQ usually contains a question like "What are the current odds..."
      // with all outcomes and probabilities in the answer text
      const oddsQuestion = faqData.mainEntity.find(
        (q: any) => q.name?.toLowerCase().includes('current odds') ||
                     q.name?.toLowerCase().includes('price of')
      );

      if (oddsQuestion?.acceptedAnswer?.text) {
        const answerText = oddsQuestion.acceptedAnswer.text;
        // Extract outcomes like '"Outcome" at XX%'
        const outcomeMatches = answerText.matchAll(/"([^"]+)"\s+(?:at|is)\s+(\d+%)/gi);
        const outcomes: [string, string][] = [...outcomeMatches].map((m) => [m[1], m[2]]);

        if (outcomes.length > 0) {
          parts.push('## Current Odds\n');
          parts.push('| Outcome | Probability |');
          parts.push('| --- | --- |');
          outcomes.forEach(([name, prob]) => parts.push(`| ${name} | ${prob} |`));
          parts.push('');
        }
      }
    }

    // Fallback: extract outcomes from the DOM if FAQ didn't yield results
    if (!parts.some((p) => p.includes('Current Odds'))) {
      // Try to find outcome elements in the page
      const outcomeEls = document.querySelectorAll(
        '[class*="outcome"], [class*="market-option"], [class*="option-row"]'
      );
      if (outcomeEls.length > 0) {
        parts.push('## Current Odds\n');
        parts.push('| Outcome | Probability |');
        parts.push('| --- | --- |');
        outcomeEls.forEach((el) => {
          const txt = el.textContent?.trim() || '';
          const match = txt.match(/(.*?)(\d+(?:\.\d+)?[%¢])/);
          if (match) parts.push(`| ${match[1].trim()} | ${match[2]} |`);
        });
        parts.push('');
      }

      // Fallback: just scan body text for percentages near outcome names
      if (!parts.some((p) => p.includes('Current Odds'))) {
        const bodyText = document.body.innerText;
        // Look for patterns like ">$600M72%"  or "Yes 63¢"
        const yesNo = bodyText.match(/(?:Yes|No)\s*\d+(?:\.\d+)?[%¢]/g);
        if (yesNo) {
          parts.push('## Current Odds\n');
          yesNo.forEach((m) => parts.push(`- ${m}`));
          parts.push('');
        }
      }
    }

    // ---------- 7. Description ----------
    const description = eventData?.description || ogDesc || twitterDesc || '';
    if (description) {
      // Clean up known Polymarket boilerplate from the description
      const cleaned = description
        .replace(/View real-time odds.*?Prediction Market™?/i, '')
        .replace(/\$[\d,.]+[KMB]?\s+has traded on.*?as of.*?\./i, '')
        .trim();
      if (cleaned.length > 20) {
        parts.push('## Description\n');
        parts.push(cleaned);
        parts.push('');
      }
    }

    // ---------- 8. Resolution rules from FAQ ----------
    if (faqData?.mainEntity?.length) {
      const rulesQ = faqData.mainEntity.find(
        (q: any) => q.name?.toLowerCase().includes('resolved') ||
                     q.name?.toLowerCase().includes('resolution')
      );
      if (rulesQ?.acceptedAnswer?.text) {
        parts.push('## Resolution Rules\n');
        parts.push(rulesQ.acceptedAnswer.text);
        parts.push('');
      }

      // When does it close?
      const closeQ = faqData.mainEntity.find(
        (q: any) => q.name?.toLowerCase().includes('close') ||
                     q.name?.toLowerCase().includes('when does')
      );
      if (closeQ?.acceptedAnswer?.text) {
        parts.push('## Timeline\n');
        parts.push(closeQ.acceptedAnswer.text);
        parts.push('');
      }
    }

    // ---------- 9. Key stats from FAQ answers ----------
    if (faqData?.mainEntity?.length) {
      const tradingQ = faqData.mainEntity.find(
        (q: any) => q.name?.toLowerCase().includes('trading activity') ||
                     q.name?.toLowerCase().includes('how much')
      );
      if (tradingQ?.acceptedAnswer?.text) {
        parts.push('## Trading Activity\n');
        parts.push(tradingQ.acceptedAnswer.text);
        parts.push('');
      }

      // Reliability / accuracy
      const reliabilityQ = faqData.mainEntity.find(
        (q: any) => q.name?.toLowerCase().includes('reliable') ||
                     q.name?.toLowerCase().includes('accuracy')
      );
      if (reliabilityQ?.acceptedAnswer?.text) {
        parts.push('## Market Reliability\n');
        parts.push(reliabilityQ.acceptedAnswer.text);
        parts.push('');
      }
    }

    // ---------- 10. Comments from JSON-LD ----------
    if (discussionData?.comment?.length) {
      const commentCount = discussionData.commentCount || discussionData.comment.length;
      parts.push(`## Comments (${commentCount})\n`);

      const comments: any[] = discussionData.comment.slice(0, 15);
      comments.forEach((c: any) => {
        const author = c.author?.name || 'Anonymous';
        const date = c.datePublished
          ? new Date(c.datePublished).toLocaleDateString()
          : '';
        const text = c.text || '';
        if (text) {
          parts.push(`**${author}**${date ? ` (${date})` : ''}:`);
          parts.push(`> ${text}\n`);

          // Nested replies
          if (c.comment?.length) {
            c.comment.forEach((reply: any) => {
              const rAuthor = reply.author?.name || 'Anonymous';
              const rText = reply.text || '';
              if (rText) {
                parts.push(`  **${rAuthor}** (reply):`);
                parts.push(`  > ${rText}\n`);
              }
            });
          }
        }
      });
    }

    // ---------- 11. Fallback broad sweep ----------
    if (parts.length < 5) {
      const mainEl = document.querySelector('main, [role="main"]');
      if (mainEl) {
        const cleaned = Utils.removeNoise(mainEl, [
          ...Utils.NOISE_SELECTORS,
          'header', 'nav', 'script', 'style', 'iframe',
        ]);
        parts.push('## Page Content\n');
        parts.push(Markdown.elementToMarkdown(cleaned));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
