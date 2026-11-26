/**
 * Polymarket extractor.
 *
 * Polymarket is a Next.js SPA - most structured data lives in JSON-LD
 * script tags, __NEXT_DATA__, and Open Graph meta tags rather than stable DOM selectors.
 * This extractor mines those sources for a rich, complete output.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;

register({
  name: 'Polymarket',
  matches: [
    '*://polymarket.com/event/*',
    '*://www.polymarket.com/event/*',
    '*://polymarket.com/market/*',
    '*://www.polymarket.com/market/*',
    '*://polymarket.com/sports/*',
    '*://www.polymarket.com/sports/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      'div.flex.items-center:has(.bookmarkButton)',
      'main h1',
      'h1',
    ].join(', '),
    position: 'overlay',
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

    // After in-app navigation, the previous event stays in the page as hidden content with its own JSON-LD.
    const isVisible = Utils.createVisibilityChecker();
    const slug = window.location.pathname.match(/^\/event\/([^/]+)/)?.[1] || '';
    const isOtherEvent = (value: unknown): boolean => {
      const eventSlug = stringValue(value).match(/\/event\/([^/?#]+)/)?.[1];
      return Boolean(slug && eventSlug && eventSlug !== slug);
    };

    // ---------- 1. Parse JSON-LD blocks (supporting arrays and @graph) ----------
    const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .filter((script) => slug || document.head.contains(script) || isVisible(script.parentElement));
    let eventData: JsonRecord | null = null;
    let discussionData: JsonRecord | null = null;
    let faqData: JsonRecord | null = null;
    let breadcrumbData: JsonRecord | null = null;

    // Event pages compare the URL. The FAQ and the breadcrumb have none, and follow the event that they describe.
    let skipGroup = false;
    for (const script of jsonLdScripts) {
      try {
        const parsed: unknown = JSON.parse(script.textContent || '');
        for (const node of flattenJsonLd(parsed)) {
          const types = nodeTypes(node['@type']);
          if (types.includes('Event')) skipGroup = isOtherEvent(node.url);
          if (skipGroup || isOtherEvent(node.url)) continue;
          if (types.includes('Event')) eventData = node;
          else if (types.includes('DiscussionForumPosting')) discussionData = node;
          else if (types.includes('FAQPage')) faqData = node;
          else if (types.includes('BreadcrumbList')) breadcrumbData = node;
        }
      } catch { /* ignore */ }
    }

    const nextMarket = readNextDataMarket(slug);

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
    const title = stringValue(eventData?.name)
      || stringValue(nextMarket?.title || nextMarket?.question)
      || (slug && Array.from(document.querySelectorAll('h1')).find(isVisible)?.textContent?.trim())
      || ogTitle
      || document.querySelector('h1')?.textContent?.trim()
      || Utils.getPageTitle();

    // ---------- 4. Metadata ----------
    const startDateRaw = stringValue(eventData?.startDate || nextMarket?.startDate);
    const endDateRaw = stringValue(eventData?.endDate || nextMarket?.endDate);
    const metadata: Record<string, string> = {
      source: 'Polymarket',
      title,
      url,
    };
    if (category) metadata.category = category;
    if (subcategory) metadata.subcategory = subcategory;
    if (status) metadata.status = status;
    if (startDateRaw) metadata.start_date = startDateRaw;
    if (endDateRaw) metadata.end_date = endDateRaw;

    // ---------- 5. Build Markdown ----------
    const parts: string[] = [`# ${title}\n`];

    // Category breadcrumb
    const breadcrumbItems = Array.isArray(breadcrumbData?.itemListElement)
      ? breadcrumbData.itemListElement
      : [];
    if (breadcrumbItems.length) {
      const crumbs = breadcrumbItems
        .map((item) => stringValue(asRecord(item)?.name))
        .filter(Boolean)
        .join(' → ');
      if (crumbs) parts.push(`**Category:** ${crumbs}`);
    } else if (category) {
      parts.push(`**Category:** ${category}${subcategory ? ` → ${subcategory}` : ''}`);
    }
    if (status) parts.push(`**Status:** ${status}`);
    const formattedStart = formatValidDate(startDateRaw);
    const formattedEnd = formatValidDate(endDateRaw);
    if (formattedStart) parts.push(`**Started:** ${formattedStart}`);
    if (formattedEnd) parts.push(`**Resolves:** ${formattedEnd}`);
    parts.push('');

    // Volume (from og:description which often contains "$14.9M traded")
    const volumeMatch = (ogDesc || twitterDesc || '').match(/\$([\d,.]+\s*(?:million|billion|[KMB])?\s*)/i);
    if (volumeMatch) {
      parts.push(`**Volume:** $${volumeMatch[1].trim()}\n`);
    }

    // ---------- 6. Outcomes from FAQ, __NEXT_DATA__, or DOM ----------
    let emittedOdds = false;
    let knownOutcomes: Array<[string, string]> = [];
    const faqEntities = Array.isArray(faqData?.mainEntity)
      ? faqData.mainEntity.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
      : [];

    if (faqEntities.length) {
      const oddsQuestion = faqEntities.find((q) => {
        const name = stringValue(q.name).toLowerCase();
        return name.includes('current odds') || name.includes('price of');
      });

      const answerText = stringValue(asRecord(oddsQuestion?.acceptedAnswer)?.text);
      if (answerText) {
        const outcomeMatches = answerText.matchAll(/"([^"]+)"\s+(?:at|is)\s+((?:<\s*)?\d+(?:\.\d+)?%)/gi);
        knownOutcomes = [...outcomeMatches].map((m) => [m[1], m[2]]);
      }
    }

    // The FAQ names only the leading outcomes of a market with many outcomes.
    for (const outcomes of [nextMarket ? extractNextDataOutcomes(nextMarket) : [], extractOutcomeRows(isVisible)]) {
      if (outcomes.length > knownOutcomes.length) knownOutcomes = outcomes;
    }
    if (knownOutcomes.length > 0) {
      appendOddsTable(parts, knownOutcomes);
      emittedOdds = true;
    }

    if (!emittedOdds) {
      const outcomeEls = document.querySelectorAll(
        '[class*="outcome"], [class*="market-option"], [class*="option-row"]',
      );
      const domOutcomes: Array<[string, string]> = [];
      outcomeEls.forEach((el) => {
        if (!isVisible(el)) return;
        const txt = el.textContent?.replace(/\s+/g, ' ').trim() || '';
        const match = txt.match(/^(.*?)\s*((?:<\s*)?\d+(?:\.\d+)?[%¢])$/);
        if (match && match[1].trim()) {
          domOutcomes.push([match[1].trim(), match[2].trim()]);
        }
      });
      if (domOutcomes.length > 0) {
        appendOddsTable(parts, domOutcomes);
        emittedOdds = true;
      }
    }

    if (!emittedOdds) {
      const bodyText = document.body.innerText || '';
      const yesNo = bodyText.match(/(?:Yes|No)\s*(?:<\s*)?\d+(?:\.\d+)?[%¢]/g);
      if (yesNo && yesNo.length > 0) {
        parts.push('## Current Odds\n');
        yesNo.forEach((m) => parts.push(`- ${m}`));
        parts.push('');
      }
    }

    // ---------- 7. Description ----------
    const description = stringValue(eventData?.description)
      || stringValue(nextMarket?.description)
      || ogDesc
      || twitterDesc
      || '';
    if (description) {
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

    // ---------- 8. Resolution rules & timeline ----------
    // The FAQ answer can only point to the rules tab, so prefer the tab itself.
    const rulesEl = Array.from(document.querySelectorAll('[role="tabpanel"][id$="-panel-rules"]'))
      .find((panel) => !panel.parentElement || isVisible(panel.parentElement))?.querySelector('span');
    const rulesQ = faqEntities.find((q) => {
      const name = stringValue(q.name).toLowerCase();
      return name.includes('resolved') || name.includes('resolution');
    });
    const rulesText = (rulesEl ? Markdown.elementToMarkdown(rulesEl) : '')
      || stringValue(asRecord(rulesQ?.acceptedAnswer)?.text);
    if (rulesText) {
      parts.push('## Resolution Rules\n', rulesText, '');
    }

    if (faqEntities.length) {
      const closeQ = faqEntities.find((q) => {
        const name = stringValue(q.name).toLowerCase();
        return name.includes('close') || name.includes('when does');
      });
      const closeText = stringValue(asRecord(closeQ?.acceptedAnswer)?.text);
      if (closeText) {
        parts.push('## Timeline\n', closeText, '');
      }

      const tradingQ = faqEntities.find((q) => {
        const name = stringValue(q.name).toLowerCase();
        return name.includes('trading activity') || name.includes('how much');
      });
      const tradingText = stringValue(asRecord(tradingQ?.acceptedAnswer)?.text);
      if (tradingText) {
        parts.push('## Trading Activity\n', tradingText, '');
      }

      const reliabilityQ = faqEntities.find((q) => {
        const name = stringValue(q.name).toLowerCase();
        return name.includes('reliable') || name.includes('accuracy');
      });
      const reliabilityText = stringValue(asRecord(reliabilityQ?.acceptedAnswer)?.text);
      if (reliabilityText) {
        parts.push('## Market Reliability\n', reliabilityText, '');
      }
    }

    // ---------- 9. Comments from JSON-LD ----------
    const rawComments = Array.isArray(discussionData?.comment)
      ? discussionData.comment.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
      : [];
    if (rawComments.length) {
      const commentCount = stringValue(discussionData?.commentCount) || String(rawComments.length);
      parts.push(`## Comments (${commentCount})\n`);

      rawComments.forEach((c) => {
        const author = stringValue(asRecord(c.author)?.name) || 'Anonymous';
        const date = formatValidDate(stringValue(c.datePublished));
        const text = stringValue(c.text);
        if (text) {
          parts.push(`**${author}**${date ? ` (${date})` : ''}:`);
          parts.push(...text.split(/\r?\n/).map((line) => `> ${line}`), '');

          const nestedReplies = Array.isArray(c.comment)
            ? c.comment.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
            : [];
          nestedReplies.forEach((reply) => {
            const rAuthor = stringValue(asRecord(reply.author)?.name) || 'Anonymous';
            const rText = stringValue(reply.text);
            if (rText) {
              parts.push(`  **${rAuthor}** (reply):`);
              parts.push(...rText.split(/\r?\n/).map((line) => `  > ${line}`), '');
            }
          });
        }
      });
    }

    // ---------- 10. Fallback broad sweep ----------
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

function appendOddsTable(parts: string[], outcomes: Array<[string, string]>): void {
  parts.push('## Current Odds\n');
  parts.push('| Outcome | Probability |');
  parts.push('| --- | --- |');
  outcomes.forEach(([name, prob]) => {
    parts.push(`| ${Markdown.escapeMarkdownTableCell(name)} | ${Markdown.escapeMarkdownTableCell(prob)} |`);
  });
  parts.push('');
}

function flattenJsonLd(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const record = asRecord(value);
  if (!record) return [];
  const graph = Array.isArray(record['@graph']) ? record['@graph'].flatMap(flattenJsonLd) : [];
  return [record, ...graph];
}

function nodeTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function readNextDataMarket(slug: string): JsonRecord | null {
  const script = document.getElementById('__NEXT_DATA__');
  const raw = script?.textContent || '';
  // The data of the first page stays in place after in-app navigation.
  if (!raw || raw.length > 8_000_000 || !raw.includes(slug)) return null;
  if (!/(?:"outcomes"|"outcomePrices"|"markets"|"question")/.test(raw)) return null;
  try {
    const market = findMarketObject(JSON.parse(raw));
    const isOther = slug && Array.isArray(market?.markets) && market.slug && market.slug !== slug;
    return isOther ? null : market;
  } catch {
    return null;
  }
}

function findMarketObject(root: unknown, depth = 0): JsonRecord | null {
  if (depth > 8 || root === null || root === undefined) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findMarketObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(root);
  if (!record) return null;
  if (
    (Array.isArray(record.markets) && record.markets.length > 0 && (record.title || record.slug))
    || (record.outcomes && record.outcomePrices && (record.question || record.title))
  ) {
    return record;
  }
  for (const child of Object.values(record)) {
    const found = findMarketObject(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractOutcomeRows(isVisible: (element: Element) => boolean): Array<[string, string]> {
  const results = new Map<string, string>();
  document.querySelectorAll('[data-scroll-anchor^="event-detail-accordion-item"]').forEach((row) => {
    if (!isVisible(row)) return;
    const texts = Array.from(row.querySelectorAll('p'))
      .map((el) => Markdown.normalizeWhitespace(el.textContent || ''));
    // An outcome name can be a percentage too.
    const [name = '', ...details] = texts;
    const value = details.find((text) => /^[<>]?\s*\d+(?:\.\d+)?%$/.test(text))
      || details.find((text) => /^(?:Yes|No)$/.test(text)) || '';
    if (name && value && !results.has(name)) results.set(name, value);
  });
  return [...results];
}

function extractNextDataOutcomes(market: JsonRecord): Array<[string, string]> {
  const results: Array<[string, string]> = [];
  const parseList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(stringValue).filter(Boolean);
      } catch { /* ignore */ }
    }
    return [];
  };

  if (Array.isArray(market.markets) && market.markets.length > 0) {
    for (const entry of market.markets) {
      const sub = asRecord(entry);
      if (!sub) continue;
      const label = stringValue(sub.groupItemTitle || sub.question || sub.title);
      const prices = parseList(sub.outcomePrices);
      if (label && prices[0]) {
        const pct = formatProbability(prices[0]);
        if (pct) results.push([label, pct]);
      }
    }
    return results;
  }

  const outcomes = parseList(market.outcomes);
  const prices = parseList(market.outcomePrices);
  for (let i = 0; i < Math.min(outcomes.length, prices.length); i++) {
    const pct = formatProbability(prices[i]);
    if (outcomes[i] && pct) results.push([outcomes[i], pct]);
  }
  return results;
}

function formatProbability(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num)) return '';
  const pct = num <= 1 ? num * 100 : num;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct * 10) / 10}%`;
}

function formatValidDate(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString();
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
