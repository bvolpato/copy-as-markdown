/**
 * Amazon product page extractor.
 * Extracts product title, price, rating, features, description, and top reviews.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;

const AMAZON_TLDS = [
  'com', 'co.uk', 'de', 'fr', 'ca', 'com.br', 'com.au', 'co.jp',
  'in', 'es', 'it', 'nl', 'com.mx', 'se', 'pl', 'sg', 'ae', 'sa',
  'com.tr', 'com.be', 'eg', 'ie',
];

const AMAZON_MATCHES = AMAZON_TLDS.flatMap((tld) => [
  `*://*.amazon.${tld}/*/dp/*`,
  `*://*.amazon.${tld}/dp/*`,
  `*://*.amazon.${tld}/gp/product/*`,
  `*://*.amazon.${tld}/gp/aw/d/*`,
]);

register({
  name: 'Amazon',
  matches: AMAZON_MATCHES,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#title',                               // product title container
      '#titleSection',                        // alt title section
      '#productTitle',                        // product title element
    ].join(', '),
    position: 'after',
    style: 'icon',
    css: { marginTop: '4px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const productLd = findProductSchema();

    const titleEl = document.getElementById('productTitle');
    const title = titleEl?.textContent?.trim()
      || stringValue(productLd?.name)
      || Utils.getPageTitle();

    // ASIN from URL
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i)
      || url.match(/\/product\/([A-Z0-9]{10})/i)
      || url.match(/\/gp\/aw\/d\/([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : stringValue(productLd?.sku);

    const metadata: Record<string, string> = {
      source: 'Amazon',
      title,
      url,
    };
    if (asin) metadata.asin = asin;

    const parts: string[] = [`# ${title}\n`];

    // Brand
    const brandEl = document.querySelector('#bylineInfo, .po-brand .a-span9 .a-size-base');
    const brand = brandEl?.textContent?.trim()
      || stringValue(asRecord(productLd?.brand)?.name)
      || stringValue(productLd?.brand);
    if (brand) parts.push(`**Brand:** ${brand}`);

    // Price: scope to the primary product price container before falling back to any .a-price on the page.
    const priceScope = document.querySelector(
      '#corePrice_feature_div, #corePriceDisplay_desktop_feature_div, #apex_desktop, #buybox',
    );
    const priceText = priceIn(priceScope) || priceIn(document);
    const ldOffer = asRecord(Array.isArray(productLd?.offers) ? productLd?.offers[0] : productLd?.offers);
    const ldPrice = stringValue(ldOffer?.price);
    const ldCurrency = stringValue(ldOffer?.priceCurrency);
    const price = priceText
      || (ldPrice ? (ldCurrency ? `${ldCurrency} ${ldPrice}` : ldPrice) : '');
    if (price) parts.push(`**Price:** ${price}`);

    // Rating
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
    const ldRating = asRecord(productLd?.aggregateRating);
    const rating = ratingEl?.textContent?.trim() || stringValue(ldRating?.ratingValue);
    const reviewCountEl = document.querySelector('#acrCustomerReviewText');
    const reviewCount = reviewCountEl?.textContent?.trim() || stringValue(ldRating?.reviewCount);
    if (rating) parts.push(`**Rating:** ${rating}${reviewCount ? ` (${reviewCount})` : ''}`);

    // Availability
    const availEl = document.querySelector('#availability span, #outOfStock span');
    const avail = availEl?.textContent?.trim() || '';
    if (avail) parts.push(`**Availability:** ${avail}`);

    parts.push('');

    // Feature bullets: prefer span.a-list-item without also selecting its parent <li>.
    const bulletSpans = document.querySelectorAll('#feature-bullets li span.a-list-item');
    const featureBullets = bulletSpans.length > 0
      ? bulletSpans
      : document.querySelectorAll('#feature-bullets ul li');
    const seenBullets = new Set<string>();
    const bullets: string[] = [];
    featureBullets.forEach((bullet) => {
      const text = bullet.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (text.length > 5 && !seenBullets.has(text)) {
        seenBullets.add(text);
        bullets.push(text);
      }
    });
    if (bullets.length > 0) {
      parts.push('## Key Features\n');
      bullets.forEach((text) => parts.push(`- ${text}`));
      parts.push('');
    }

    // Product details / tech specs / overview
    const detailPairs = collectProductDetails();
    if (detailPairs.length > 0) {
      parts.push('## Product Details\n');
      detailPairs.forEach(([label, value]) => parts.push(`- **${label}:** ${value}`));
      parts.push('');
    }

    // Product description
    const descEl = document.querySelector('#productDescription, #productDescription_feature_div');
    if (descEl) {
      const descText = Markdown.elementToMarkdown(Utils.removeNoise(descEl, Utils.NOISE_SELECTORS));
      if (descText && descText.length > 20) {
        parts.push('## Description\n');
        parts.push(descText);
        parts.push('');
      }
    } else {
      const ldDesc = stringValue(productLd?.description);
      if (ldDesc.length > 20) {
        parts.push('## Description\n', ldDesc, '');
      }
    }

    // "About this item" from aplus
    const aplusEl = document.querySelector('#aplus .aplus-v2');
    if (aplusEl) {
      const aplusText = Markdown.elementToMarkdown(
        Utils.removeNoise(aplusEl, [...Utils.NOISE_SELECTORS, 'script', 'style', '.apm-tablemodule']),
      );
      if (aplusText.trim().length > 50) {
        parts.push('## About This Item\n');
        parts.push(aplusText);
        parts.push('');
      }
    }

    // Top reviews
    const reviewEls = document.querySelectorAll('[data-hook="review"]');
    if (reviewEls.length > 0) {
      parts.push(`## Top Reviews (${reviewEls.length})\n`);
      reviewEls.forEach((review) => {
        const reviewer = review.querySelector('.a-profile-name')?.textContent?.trim() || '';
        const stars = review.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .a-icon-star span')?.textContent?.trim() || '';
        // The title link also holds the star rating, so use its own last span.
        const reviewTitle = review.querySelector('[data-hook="review-title"] > span:last-child')?.textContent?.trim()
          || review.querySelector('[data-hook="review-title"] span:last-child, .review-title')?.textContent?.trim() || '';
        const reviewDate = review.querySelector('[data-hook="review-date"]')?.textContent?.trim() || '';
        const reviewBody = review.querySelector('[data-hook="review-body"] span, .review-text-content span')?.textContent?.trim() || '';

        parts.push(`### ${stars ? `${stars} - ` : ''}${reviewTitle}\n`);
        parts.push(`*By ${reviewer}${reviewDate ? ` · ${reviewDate}` : ''}*\n`);
        if (reviewBody) parts.push(`${reviewBody}\n`);
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function priceIn(scope: ParentNode | null): string {
  if (!scope) return '';
  const selectors = ['.priceToPay', '.apexPriceToPay', '.a-price', '#priceblock_dealprice', '#priceblock_ourprice'];
  for (const element of selectors.flatMap((selector) => Array.from(scope.querySelectorAll(selector)))) {
    // Current layouts leave the offscreen copy blank and split the visible price into parts.
    const text = element.querySelector('.a-offscreen')?.textContent?.trim()
      || element.querySelector('[aria-hidden="true"]')?.textContent?.replace(/\s+/g, '')
      || element.textContent?.trim() || '';
    if (text) return text;
  }
  return '';
}

function cleanDetailLabel(value: string): string {
  return value.replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
}

function cleanDetailValue(value: string): string {
  return value.replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
}

function collectProductDetails(): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  const addPair = (rawLabel: string, rawValue: string) => {
    const label = cleanDetailLabel(rawLabel);
    const value = cleanDetailValue(rawValue);
    if (!label || !value) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([label, value]);
  };

  document.querySelectorAll('#productOverview_feature_div tr').forEach((row) => {
    const cells = row.querySelectorAll('td, th');
    if (cells.length >= 2) {
      addPair(cells[0].textContent || '', cells[1].textContent || '');
    }
  });

  document.querySelectorAll(
    '#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, .a-keyvalue tr',
  ).forEach((row) => {
    const label = row.querySelector('th, .prodDetAttrName')?.textContent || '';
    const value = row.querySelector('td, .prodDetAttrValue')?.textContent || '';
    addPair(label, value);
  });

  document.querySelectorAll('#detailBullets_feature_div li').forEach((row) => {
    const bold = row.querySelector('.a-text-bold');
    if (!bold) return;
    const label = bold.textContent || '';
    const valueEl = bold.nextElementSibling;
    const value = valueEl?.textContent || '';
    addPair(label, value);
  });

  return pairs;
}

function findProductSchema(): JsonRecord | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    const raw = script.textContent || '';
    if (!raw || !/Product/i.test(raw)) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const records = flattenRecords(parsed);
      const found = records.find((record) => /Product/i.test(stringValue(record['@type'])));
      if (found) return found;
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
}

function flattenRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenRecords);
  const record = asRecord(value);
  if (!record) return [];
  const graph = Array.isArray(record['@graph']) ? record['@graph'].flatMap(flattenRecords) : [];
  return [record, ...graph];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
