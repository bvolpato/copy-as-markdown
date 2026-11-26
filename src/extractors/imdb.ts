/**
 * IMDb title page extractor (movies, TV series, ratings, cast, synopsis).
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function readImdbSchema(): Record<string, unknown> | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || '');
      if (parsed && typeof parsed === 'object' && /Movie|TVSeries|TVEpisode|VideoGame/i.test(String(parsed['@type'] || ''))) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return null;
}

export const imdbExtractor = register({
  name: 'IMDb',
  matches: [
    '*://www.imdb.com/title/*',
    '*://imdb.com/title/*',
    '*://m.imdb.com/title/*',
  ],
  pathnameRegex: /^\/title\/tt\d+/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="hero__pageTitle"], h1[data-testid="hero-title-block__title"], main h1, h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const schema = readImdbSchema();
    const title = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="hero__pageTitle"], h1[data-testid="hero-title-block__title"], main h1')?.textContent
        || (typeof schema?.name === 'string' ? schema.name : '')
        || Utils.getPageTitle().replace(/\s*-\s*IMDb$/i, ''),
    );

    const ratingObj = schema?.aggregateRating as Record<string, unknown> | undefined;
    const ratingVal = ratingObj?.ratingValue !== undefined
      ? `${ratingObj.ratingValue}/10${ratingObj.ratingCount ? ` (${Number(ratingObj.ratingCount).toLocaleString()} votes)` : ''}`
      : Markdown.normalizeWhitespace(document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"]')?.textContent || '');

    const genres = Array.isArray(schema?.genre)
      ? schema.genre.filter((g): g is string => typeof g === 'string')
      : Array.from(document.querySelectorAll('[data-testid="genres"] a, .ipc-chip--on-baseAlt')).map((el) => Markdown.normalizeWhitespace(el.textContent || '')).filter(Boolean);

    const published = typeof schema?.datePublished === 'string' ? schema.datePublished : '';
    const contentRating = typeof schema?.contentRating === 'string' ? schema.contentRating : '';

    const metadata: PageMetadata = {
      source: 'IMDb',
      title,
      url: Utils.getCanonicalUrl(),
      rating: ratingVal || undefined,
      published: published || undefined,
      genres: genres.length > 0 ? [...new Set(genres)].join(', ') : undefined,
    };

    const parts: string[] = [`# ${title}`];
    const meta = [
      ratingVal ? `**Rating:** ${ratingVal}` : '',
      published ? `**Released:** ${published}` : '',
      contentRating ? `**Rated:** ${contentRating}` : '',
      genres.length > 0 ? `**Genres:** ${[...new Set(genres)].join(', ')}` : '',
    ].filter(Boolean);
    if (meta.length > 0) parts.push(meta.join(' | '));

    const plot = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="plot-xl"], [data-testid="plot-l"], [data-testid="plot"]')?.textContent
        || (typeof schema?.description === 'string' ? schema.description : ''),
    );
    if (plot) parts.push(`\n## Synopsis\n\n${plot}`);

    const castCards = Array.from(document.querySelectorAll('[data-testid="title-cast-item"]'));
    if (castCards.length > 0) {
      const castLines = castCards.map((card) => {
        const actor = Markdown.normalizeWhitespace(card.querySelector('[data-testid="title-cast-item__actor"]')?.textContent || '');
        const character = Markdown.normalizeWhitespace(card.querySelector('[data-testid="cast-item-characters-link"]')?.textContent || '');
        return actor ? (character ? `- **${actor}** as ${character}` : `- **${actor}**`) : '';
      }).filter(Boolean);
      if (castLines.length > 0) parts.push('\n## Top Cast\n\n' + castLines.join('\n'));
    } else if (Array.isArray(schema?.actor)) {
      const actors = schema.actor
        .map((a) => (a && typeof a === 'object' && typeof (a as Record<string, unknown>).name === 'string' ? (a as Record<string, unknown>).name as string : ''))
        .filter(Boolean);
      if (actors.length > 0) parts.push('\n## Top Cast\n\n' + actors.map((a) => `- ${a}`).join('\n'));
    }

    const storyline = document.querySelector('[data-testid="storyline-plot-summary"]');
    if (storyline) {
      const storyMd = Markdown.elementToMarkdown(storyline);
      if (storyMd && storyMd !== plot) parts.push(`\n## Storyline\n\n${storyMd}`);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered IMDb title page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
