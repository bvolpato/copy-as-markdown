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
    '*://www.booking.com/searchresults*.html*',
    '*://booking.com/hotel/*',
    '*://booking.com/searchresults*.html*',
    '*://m.booking.com/hotel/*',
    '*://m.booking.com/searchresults*.html*',
  ],
  pathnameRegex: /^\/(?:hotel\/[^/?#]+|searchresults(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html)/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#hp_hotel_name',
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
    const isSearch = /^\/searchresults(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html/i.test(window.location.pathname);
    const route = isSearch ? 'search' : 'hotel';

    if (isSearch) {
      return extractSearchResults(url);
    }

    const payload = firstHotelPayload();
    const title = firstText([
      '#hp_hotel_name',
      '[data-testid="property-header"] h2',
      '[data-testid="property-header"] h1',
      'h1',
    ]) || stringValue(payload?.name) || Utils.getMeta('title') || Utils.getPageTitle();
    const location = firstText([
      '[data-testid="property-header"] [data-testid*="address"]',
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
    ]) || stringValue(asRecord(payload?.offers)?.price) || stringValue(payload?.price);
    const description = firstText([
      '#property_description_content',
      '[data-testid="property-description"]',
      '[data-testid="property-header"] + section',
      '[data-testid="hotel-description"]',
    ]) || stringValue(payload?.description) || Utils.getMeta('description');

    const metadata: Record<string, string> = {
      source: 'Booking.com', title, url, route, location, rating,
      reviews: reviewCount, price,
    };
    const parts: string[] = [`# ${title}`, ''];
    if (location) parts.push(`**Location:** ${location}`);
    if (rating && reviewCount) parts.push(`**Rating:** ${rating} (${reviewCount} reviews)`);
    else if (rating) parts.push(`**Rating:** ${rating}`);
    else if (reviewCount) parts.push(`**Reviews:** ${reviewCount}`);
    if (price) parts.push(`**Price:** ${price}`);
    parts.push('');
    if (description) parts.push('## Description', '', description, '');

    const amenities = extractRows([
      '[data-testid="property-facilities"] li',
      '[data-testid="facility-list"] li',
      '[data-testid*="facility"] li',
    ]);
    if (amenities.length) parts.push('## Amenities', '', ...amenities.map((item) => `- ${item}`), '');

    const rooms = extractRows([
      '#hprt-table tbody tr',
      '[data-testid="rooms-table"] tr',
      '[data-testid="room-list"] [data-testid*="room"]',
    ]);
    if (rooms.length) parts.push('## Rooms', '', ...rooms.map((room) => `- ${room}`), '');

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function extractSearchResults(url: string): string {
  const title = firstText([
    'h1',
    '[data-testid="search-header"] h1',
  ]) || Utils.getMeta('title') || Utils.getPageTitle() || 'Booking.com Search Results';
  const description = Utils.getMeta('description');
  const metadata: Record<string, string> = {
    source: 'Booking.com',
    title,
    url,
    route: 'search',
  };

  const parts: string[] = [`# ${title}`, ''];
  if (description) parts.push(description, '');

  const cards = Array.from(document.querySelectorAll('[data-testid="property-card"]'));
  if (cards.length) {
    parts.push('## Search Results', '');
    cards.forEach((card, index) => {
      const cardTitle = card.querySelector('[data-testid="title"], h3')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const cardLink = card.querySelector<HTMLAnchorElement>('[data-testid="title-link"], h3 a, a[href*="/hotel/"]')?.href || '';
      const cardLocation = card.querySelector('[data-testid*="address"], [data-testid*="location"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const cardRating = card.querySelector('[data-testid="review-score"], [aria-label*="Scored"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const cardPrice = card.querySelector('[data-testid*="price"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (cardTitle) {
        parts.push(`### ${index + 1}. ${cardTitle}`);
        if (cardLink) parts.push(`**URL:** ${cardLink}`);
        if (cardLocation) parts.push(`**Location:** ${cardLocation}`);
        if (cardRating) parts.push(`**Rating:** ${cardRating}`);
        if (cardPrice) parts.push(`**Price:** ${cardPrice}`);
        parts.push('');
      }
    });
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

type JsonRecord = Record<string, unknown>;

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (text) return text;
  }
  return '';
}

function extractRows(selectors: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
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
    if (!/(?:Hotel|LodgingBusiness|"hotelId"|"propertyId"|"hotel_id")/.test(raw)) continue;
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
