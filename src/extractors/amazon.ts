/**
 * Amazon product page extractor.
 * Extracts product title, price, rating, features, description, and top reviews.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Amazon',
  matches: [
    '*://www.amazon.com/*/dp/*',
    '*://www.amazon.com/dp/*',
    '*://www.amazon.co.uk/*/dp/*',
    '*://www.amazon.co.uk/dp/*',
    '*://www.amazon.de/*/dp/*',
    '*://www.amazon.de/dp/*',
    '*://www.amazon.fr/*/dp/*',
    '*://www.amazon.fr/dp/*',
    '*://www.amazon.ca/*/dp/*',
    '*://www.amazon.ca/dp/*',
    '*://www.amazon.com.br/*/dp/*',
    '*://www.amazon.com.br/dp/*',
    '*://www.amazon.com.au/*/dp/*',
    '*://www.amazon.com.au/dp/*',
    '*://www.amazon.co.jp/*/dp/*',
    '*://www.amazon.co.jp/dp/*',
  ],
  anchor: {
    selector: [
      '#title',                               // product title container
      '#titleSection',                         // alt title section
      '#productTitle',                         // product title element
    ].join(', '),
    position: 'after',
    style: 'icon',
    css: { marginTop: '4px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.getElementById('productTitle');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    // ASIN from URL
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/product\/([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : '';

    const metadata: Record<string, string> = {
      source: 'Amazon',
      title,
      url,
    };
    if (asin) metadata.asin = asin;

    const parts: string[] = [`# ${title}\n`];

    // Brand
    const brandEl = document.querySelector('#bylineInfo, .po-brand .a-span9 .a-size-base');
    const brand = brandEl?.textContent?.trim() || '';
    if (brand) parts.push(`**Brand:** ${brand}`);

    // Price
    const priceEl = document.querySelector('.a-price .a-offscreen, #priceblock_dealprice, #priceblock_ourprice, .a-price-whole');
    const price = priceEl?.textContent?.trim() || '';
    if (price) parts.push(`**Price:** ${price}`);

    // Rating
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
    const rating = ratingEl?.textContent?.trim() || '';
    const reviewCountEl = document.querySelector('#acrCustomerReviewText');
    const reviewCount = reviewCountEl?.textContent?.trim() || '';
    if (rating) parts.push(`**Rating:** ${rating}${reviewCount ? ` (${reviewCount})` : ''}`);

    // Availability
    const availEl = document.querySelector('#availability span, #outOfStock span');
    const avail = availEl?.textContent?.trim() || '';
    if (avail) parts.push(`**Availability:** ${avail}`);

    parts.push('');

    // Feature bullets
    const featureBullets = document.querySelectorAll('#feature-bullets li span.a-list-item, #feature-bullets ul li');
    if (featureBullets.length > 0) {
      parts.push('## Key Features\n');
      featureBullets.forEach((bullet) => {
        const text = bullet.textContent?.trim();
        if (text && text.length > 5) parts.push(`- ${text}`);
      });
      parts.push('');
    }

    // Product details / tech specs table
    const detailRows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li, .a-keyvalue tr');
    if (detailRows.length > 0) {
      parts.push('## Product Details\n');
      detailRows.forEach((row) => {
        const label = row.querySelector('th, .a-text-bold, .prodDetAttrName')?.textContent?.trim() || '';
        const value = row.querySelector('td, .prodDetAttrValue, span:not(.a-text-bold)')?.textContent?.trim() || '';
        if (label && value) parts.push(`- **${label}:** ${value}`);
      });
      parts.push('');
    }

    // Product description
    const descEl = document.querySelector('#productDescription p, #productDescription .a-spacing-small, #productDescription_feature_div');
    if (descEl) {
      const descText = descEl.textContent?.trim();
      if (descText && descText.length > 20) {
        parts.push('## Description\n');
        parts.push(descText);
        parts.push('');
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
      reviewEls.forEach((review, i) => {
        if (i >= 10) return;
        const reviewer = review.querySelector('.a-profile-name')?.textContent?.trim() || '';
        const stars = review.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .a-icon-star span')?.textContent?.trim() || '';
        const reviewTitle = review.querySelector('[data-hook="review-title"] span:last-child, .review-title')?.textContent?.trim() || '';
        const reviewDate = review.querySelector('[data-hook="review-date"]')?.textContent?.trim() || '';
        const reviewBody = review.querySelector('[data-hook="review-body"] span, .review-text-content span')?.textContent?.trim() || '';

        parts.push(`### ${stars ? stars + ' — ' : ''}${reviewTitle}\n`);
        parts.push(`*By ${reviewer}${reviewDate ? ` · ${reviewDate}` : ''}*\n`);
        if (reviewBody) parts.push(`${reviewBody}\n`);
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
