/**
 * Booking.com extractor for hotel detail and search-result routes.
 * Extracts visible hotel cards/details without copying navigation or filters.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Booking.com',
  matches: [
    '*://www.booking.com/hotel/*',
    '*://www.booking.com/searchresults.html*',
    '*://booking.com/hotel/*',
    '*://booking.com/searchresults.html*',
  ],
  pathnameRegex: /^\/(?:hotel\/[^/?#]+|searchresults\.html)/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="property-header"]',
      '[data-testid="property-card"] h3',
      'h1',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = window.location.pathname.startsWith('/searchresults.html') ? 'search' : 'hotel';
    const payload = firstHotelPayload();
    const title = firstText([
      '[data-testid="property-header"] h2',
      '[data-testid="property-header"] h1',
      '[data-testid="property-card"] h3',
      'h1',
    ]) || stringValue(payload?.name) || Utils.getMeta('title') || Utils.getPageTitle();
    const location = firstText([
      '[data-testid="property-header"] [data-testid*="address"]',
      '[data-testid="property-card"] [data-testid*="address"]',
      '[data-testid="address"]',
      '[data-testid*="location"]',
    ]) || stringValue(payload?.address && asRecord(payload.address)?.streetAddress)
      || stringValue(payload?.address && asRecord(payload.address)?.addressLocality);
    const rating = firstText([
      '[data-testid="review-score"]',
      '[data-testid="review-score-component"]',
      '[aria-label*="Scored"]',
      '[aria-label*="rating"]',
    ]) || stringValue(payload?.aggregateRating && asRecord(payload.aggregateRating)?.ratingValue);
    const reviewCount = firstText([
      '[data-testid="review-count"]',
      '[data-testid="review-score"] + *',
    ]) || stringValue(payload?.aggregateRating && asRecord(payload.aggregateRating)?.reviewCount);
    const price = firstText([
      '[data-testid="price-and-discounted-price"]',
      '[data-testid="price-for-x-nights"]',
      '[data-testid="price"]',
      '[data-testid="property-card-price"]',
    ]) || stringValue(asRecord(payload?.offers)?.price) || stringValue(payload?.price);
    const description = firstText([
      '[data-testid="property-description"]',
      '[data-testid="property-header"] + section',
      '[data-testid="hotel-description"]',
    ]) || stringValue(payload?.description) || Utils.getMeta('description');
    const hotelUrl = document.querySelector<HTMLAnchorElement>(
      '[data-testid="property-card"] h3 a, [data-testid="property-header"] a[href*="/hotel/"]',
    )?.href || stringValue(payload?.url);

    const metadata: Record<string, string> = {
      source: 'Booking.com', title, url, route, location, rating,
      reviews: reviewCount, price, hotel_url: hotelUrl,
    };
    const parts: string[] = [`# ${title}`, ''];
    if (location) parts.push(`**Location:** ${location}`);
    if (rating || reviewCount) parts.push(`**Rating:** ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}`);
    if (price) parts.push(`**Price:** ${price}`);
    if (hotelUrl && route === 'search') parts.push(`**Hotel:** ${hotelUrl}`);
    parts.push('');
    if (description) parts.push('## Description', '', Utils.truncate(description, 20_000), '');

    if (route === 'search') {
      const cards = Array.from(document.querySelectorAll('[data-testid="property-card"]')).slice(0, 30);
      if (cards.length) {
        parts.push('## Search Results', '');
        cards.forEach((card, index) => {
          const cardTitle = card.querySelector('h3')?.textContent?.trim() || '';
          const cardLocation = card.querySelector('[data-testid*="address"], [data-testid*="location"]')?.textContent?.trim() || '';
          const cardRating = card.querySelector('[data-testid="review-score"], [aria-label*="Scored"]')?.textContent?.trim() || '';
          const cardPrice = card.querySelector('[data-testid*="price"]')?.textContent?.trim() || '';
          if (cardTitle) {
            parts.push(`### ${index + 1}. ${cardTitle}`);
            if (cardLocation) parts.push(`**Location:** ${cardLocation}`);
            if (cardRating) parts.push(`**Rating:** ${cardRating}`);
            if (cardPrice) parts.push(`**Price:** ${cardPrice}`);
            parts.push('');
          }
        });
      }
    } else {
      const amenities = extractRows([
        '[data-testid="property-facilities"] li',
        '[data-testid="facility-list"] li',
        '[data-testid*="facility"] li',
      ], 60);
      if (amenities.length) parts.push('## Amenities', '', ...amenities.map((item) => `- ${item}`), '');
      const rooms = extractRows([
        '[data-testid="room-list"] [data-testid*="room"]',
        '[data-testid="rooms-table"] tr',
        '[data-testid*="room"]',
      ], 30);
      if (rooms.length) parts.push('## Rooms', '', ...rooms.map((room) => `- ${room}`), '');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonRecord = Record<string, unknown>;

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (text) return text;
  }
  return '';
}

function extractRows(selectors: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 1_000 || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function firstHotelPayload(): JsonRecord | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"], script#__NEXT_DATA__, script[id*="state"], script[id*="State"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const found = findHotelRecord(parsed);
      if (found) return found;
    } catch {
      // Booking injects partial state while search results hydrate.
    }
  }
  return null;
}

function findHotelRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 7 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findHotelRecord(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as JsonRecord;
  const type = stringValue(record['@type']);
  if (/Hotel|LodgingBusiness|Product/i.test(type) && (record.name || record.address)) return record;
  if (record.hotelId || record.propertyId || record.hotel_id) return record;
  for (const child of Object.values(record)) {
    const found = findHotelRecord(child, depth + 1);
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
