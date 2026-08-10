/**
 * Temu product-page extractor.
 * Product routes only. Search/category navigation is intentionally not copied as product content.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Temu',
  matches: [
    '*://www.temu.com/goods.html*',
    '*://www.temu.com/product/*',
    '*://www.temu.com/*-g-*',
    '*://temu.com/goods.html*',
    '*://temu.com/product/*',
    '*://temu.com/*-g-*',
  ],
  pathnameRegex: /^(?:\/goods\.html|\/product\/|\/[^/]*-g-\d+)/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="goods-title"], [data-testid="product-title"], h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const payload = firstProductPayload();
    const title = firstText([
      '[data-testid="goods-title"]',
      '[data-testid="product-title"]',
      '[class*="GoodsTitle"]',
      '[class*="goods-title"]',
      'h1',
    ]) || stringValue(payload?.name) || Utils.getMeta('title') || Utils.getPageTitle();
    const price = firstText([
      '[data-testid="price"]',
      '[data-testid="goods-price"]',
      '[class*="Price"]',
      '[class*="price"]',
    ]) || stringValue(payload?.offers && asRecord(payload.offers)?.price)
      || stringValue(payload?.price);
    const currency = stringValue(payload?.offers && asRecord(payload.offers)?.priceCurrency)
      || Utils.getMeta('price:currency');
    const rating = firstText([
      '[data-testid="rating"]',
      '[class*="Rating"]',
      '[class*="rating"]',
    ]) || stringValue(payload?.aggregateRating && asRecord(payload.aggregateRating)?.ratingValue);
    const reviewCount = firstText([
      '[data-testid="review-count"]',
      '[class*="ReviewCount"]',
      '[class*="review-count"]',
    ]) || stringValue(payload?.aggregateRating && asRecord(payload.aggregateRating)?.reviewCount);
    const availability = firstText([
      '[data-testid="availability"]',
      '[class*="Availability"]',
      '[class*="availability"]',
    ]) || stringValue(asRecord(payload?.offers)?.availability);
    const seller = firstText([
      '[data-testid="seller-name"]',
      '[data-testid="store-name"]',
      '[class*="SellerName"]',
      '[class*="store-name"]',
    ]) || stringValue(asRecord(payload?.brand)?.name) || stringValue(payload?.brand);
    const description = firstText([
      '[data-testid="description"]',
      '[data-testid="goods-description"]',
      '[class*="Description"]',
      '[class*="description"]',
    ]) || stringValue(payload?.description) || Utils.getMeta('description');
    const images = unique([
      ...Array.from(document.querySelectorAll<HTMLImageElement>('main img[alt], [data-testid="gallery"] img'))
        .map((image) => image.currentSrc || image.src),
      ...listValue(payload?.image),
    ]).slice(0, 12);

    const metadata: Record<string, string> = {
      source: 'Temu', title, url, price: price && currency && !price.includes(currency) ? `${price} ${currency}` : price,
      rating, reviews: reviewCount, availability, seller,
    };
    const parts: string[] = [`# ${title}`, ''];
    if (price) parts.push(`**Price:** ${metadata.price}`);
    if (rating || reviewCount) parts.push(`**Rating:** ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}`);
    if (availability) parts.push(`**Availability:** ${availability}`);
    if (seller) parts.push(`**Seller:** ${seller}`);
    parts.push('');
    if (description) parts.push('## Description', '', Utils.truncate(description, 20_000), '');

    const specs = Array.from(document.querySelectorAll(
      '[data-testid="specifications"] tr, [data-testid="product-details"] li, [class*="Specification"] li, [class*="specification"] li',
    )).map((row) => row.textContent?.trim() || '').filter(Boolean).slice(0, 80);
    if (specs.length) parts.push('## Product Details', '', ...specs.map((spec) => `- ${spec}`), '');
    if (images.length) parts.push('## Images', '', ...images.map((image) => `- ${image}`), '');

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonRecord = Record<string, unknown>;

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim() || '';
    if (text) return text;
  }
  return '';
}

function firstProductPayload(): JsonRecord | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"], script#__NEXT_DATA__, script[id*="state"], script[id*="STATE"]',
  );
  for (const script of scripts) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const found = findProductRecord(parsed);
      if (found) return found;
    } catch {
      // Product state may be incomplete during client-side route transitions.
    }
  }
  return null;
}

function findProductRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProductRecord(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as JsonRecord;
  const type = stringValue(record['@type']);
  if (/Product|Offer/i.test(type) && (record.name || record.title || record.description)) return record;
  if (record.goodsId || record.goods_id || record.productId || record.product_id) return record;
  for (const child of Object.values(record)) {
    const found = findProductRecord(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const item = stringValue(value);
  return item ? [item] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
