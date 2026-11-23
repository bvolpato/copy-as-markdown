/**
 * LinkedIn extractor.
 * Covers posts, profiles, Pulse articles, company pages, jobs, and newsletters.
 */

import { register } from '../core/registry';
import { limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

type JsonObject = Record<string, unknown>;

const PROFILE_SECTIONS = [
  { title: 'About', ids: ['about'], dataSections: ['summary'] },
  { title: 'Experience & Education', ids: [], dataSections: [] },
  { title: 'Experience', ids: ['experience'], dataSections: ['experience'] },
  { title: 'Education', ids: ['education'], dataSections: ['educations', 'education'] },
  { title: 'Skills', ids: ['skills'], dataSections: ['skills'] },
  { title: 'Projects', ids: ['projects'], dataSections: ['projects'] },
  { title: 'Licenses & Certifications', ids: ['licenses_and_certifications'], dataSections: ['certifications'] },
  { title: 'Volunteer Experience', ids: ['volunteering_experience'], dataSections: ['volunteering'] },
  { title: 'Publications', ids: ['publications'], dataSections: ['publications'] },
  { title: 'Courses', ids: ['courses'], dataSections: ['courses'] },
  { title: 'Honors & Awards', ids: ['honors_and_awards'], dataSections: ['honors'] },
  { title: 'Languages', ids: ['languages'], dataSections: ['languages'] },
  { title: 'Organizations', ids: ['organizations'], dataSections: ['organizations'] },
];

register({
  name: 'LinkedIn',
  matches: [
    '*://*.linkedin.com/posts/*',
    '*://*.linkedin.com/feed/update/*',
    '*://*.linkedin.com/pulse/*',
    '*://*.linkedin.com/in/*',
    '*://*.linkedin.com/company/*',
    '*://*.linkedin.com/jobs/view/*',
    '*://*.linkedin.com/newsletters/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '.feed-shared-control-menu',                // post action menu
      '.feed-shared-social-action-bar',            // post action bar
      '.social-details-social-activity',           // post social activity bar
      '.pv-top-card__actions',                     // profile actions
      '.pvs-header__actions',                      // profile section header
      '.top-card-layout__cta-container',           // public profile actions
      '.top-card-layout__entity-info',             // public profile header
      '.reader-article-header',                    // pulse article header
      '.article-header',                           // pulse article header fallback
      '.jobs-unified-top-card__content--two-pane', // job listing header
      '.org-top-card__primary-content',            // company page header
    ].join(', '),
    position: 'overlay',
    style: 'icon',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const pathname = window.location.pathname;

    if (/^\/in\//.test(pathname)) return extractProfile(url);
    if (/^\/(?:pulse|newsletters)\//.test(pathname)) return extractArticle(url);
    if (/^\/jobs\/view\//.test(pathname)) return extractJob(url);
    if (/^\/company\//.test(pathname)) return extractCompany(url);
    return extractPost(url);
  },
});

function extractProfile(url: string): string {
  const person = getLinkedInPersonData();
  const name = cleanProfileName(textOf(document.querySelector([
    '.text-heading-xlarge',
    '.pv-top-card .text-heading-xlarge',
    '.top-card-layout__title',
    'main h1',
    'h1',
  ].join(', '))) || stringValue(person?.name) || Utils.getPageTitle());
  const headline = textOf(document.querySelector([
    '.pv-text-details__left-panel .text-body-medium.break-words',
    '.pv-top-card .text-body-medium',
    '.top-card-layout__headline',
    '[data-generated-suggestion-target*="headline"]',
  ].join(', '))) || firstString(person?.jobTitle);
  const location = textOf(document.querySelector([
    '.pv-text-details__left-panel .text-body-small.inline',
    '.pv-top-card .text-body-small',
    '.top-card-layout__first-subline .profile-info-subheader > span:first-child',
  ].join(', '))) || personLocation(person);

  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Profile',
    name,
    url,
  };
  if (headline) metadata.headline = headline;
  if (location) metadata.location = location;

  const parts: string[] = [`# ${name}\n`];
  if (headline) parts.push(`**${headline}**`);
  if (location) parts.push(`📍 ${location}`);
  parts.push('');

  const includedSections = new Set<Element>();
  const includedTitles = new Set<string>();
  for (const definition of PROFILE_SECTIONS) {
    const section = findProfileSection(definition.title, definition.ids, definition.dataSections);
    if (!section || includedSections.has(section)) continue;
    const body = profileSectionMarkdown(section, definition.title);
    if (!body) continue;
    includedSections.add(section);
    includedTitles.add(definition.title);
    parts.push(`## ${definition.title}\n\n${body}`);
  }

  if (!includedTitles.has('Education')) {
    const education = textOf(document.querySelector(
      '[data-section="educationsDetails"] [data-test-id="top-card-link"], '
      + '[data-section="educationsDetails"] .top-card-link__description',
    ));
    if (education && !normalize(parts.join('\n')).includes(normalize(education))) {
      parts.push(`## Education\n\n- ${education}`);
    }
  }

  if (includedSections.size === 0) {
    const fallback = profileMainMarkdown(name);
    const description = cleanProfileDescription(
      stringValue(person?.description) || Utils.getMeta('description'),
    );
    const body = fallback || description;
    if (body) parts.push(`## Profile\n\n${body}`);
    else parts.push('*LinkedIn profile content is not rendered yet. Wait for the page to finish loading and try again.*');
  }

  const limited = limitMarkdown(parts.join('\n\n'));
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function extractJob(url: string): string {
  const title = textOf(document.querySelector(
    '.job-details-jobs-unified-top-card__job-title, .top-card-layout__title, main h1, h1',
  )) || Utils.getPageTitle();
  const company = textOf(document.querySelector(
    '.job-details-jobs-unified-top-card__company-name, .topcard__org-name-link, a[href*="/company/"]',
  ));
  const location = textOf(document.querySelector(
    '.job-details-jobs-unified-top-card__primary-description-container, .topcard__flavor--bullet',
  ));
  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Job',
    title,
    url,
  };
  if (company) metadata.company = company;
  if (location) metadata.location = location;

  const parts: string[] = [`# ${title}\n`];
  if (company) parts.push(`**Company:** ${company}`);
  if (location) parts.push(`**Location:** ${location}`);
  parts.push('');

  const descEl = document.querySelector(
    '.jobs-description__content, .jobs-box__html-content, .description__text, article, main',
  );
  if (descEl) {
    const cleaned = cleanProfileElement(descEl);
    const body = Markdown.elementToMarkdown(cleaned);
    if (body) parts.push('## Job Description\n', body);
  }
  const limited = limitMarkdown(parts.join('\n'));
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function extractCompany(url: string): string {
  const name = cleanProfileName(textOf(document.querySelector(
    '.org-top-card-summary__title, .top-card-layout__title, main h1, h1',
  )) || Utils.getPageTitle());
  const tagline = textOf(document.querySelector(
    '.org-top-card-summary__tagline, .top-card-layout__headline',
  ));
  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Company',
    title: name,
    url,
  };
  const parts: string[] = [`# ${name}\n`];
  if (tagline) parts.push(`**${tagline}**\n`);

  const root = document.querySelector('.org-grid__content-height-enforcer, .scaffold-layout__main, main');
  if (root) {
    const cleaned = cleanProfileElement(root);
    cleaned.querySelectorAll('h1').forEach((heading) => {
      if (cleanProfileName(textOf(heading)) === name) heading.remove();
    });
    const body = cleanProfileMarkdown(Markdown.elementToMarkdown(cleaned));
    if (body) parts.push(body);
  }
  const limited = limitMarkdown(parts.join('\n'));
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function findProfileSection(title: string, ids: string[], dataSections: string[]): Element | null {
  for (const id of ids) {
    const marker = document.getElementById(id);
    const section = marker?.closest('section');
    if (section) return section;
  }

  for (const value of dataSections) {
    const section = document.querySelector(`section[data-section="${value}"]`);
    if (section) return section;
  }

  const wanted = normalize(title);
  for (const section of document.querySelectorAll('main section, .scaffold-layout__main section')) {
    const heading = normalize(textOf(section.querySelector('h2, h3')));
    if (heading === wanted || heading.startsWith(`${wanted} `) || heading === `${wanted}${wanted}`) {
      return section;
    }
  }
  return null;
}

function profileSectionMarkdown(section: Element, title: string): string {
  const clone = cleanProfileElement(section);
  clone.querySelectorAll('h2, h3').forEach((heading) => {
    const value = normalize(textOf(heading));
    const wanted = normalize(title);
    if (value === wanted || value.startsWith(`${wanted} `) || value === `${wanted}${wanted}`) heading.remove();
  });
  clone.querySelectorAll('li h3, li h4').forEach((heading) => {
    const replacement = document.createElement(heading.tagName === 'H3' ? 'strong' : 'span');
    replacement.textContent = textOf(heading);
    heading.replaceWith(replacement);
  });
  return cleanProfileMarkdown(Markdown.elementToMarkdown(clone));
}

function profileMainMarkdown(name: string): string {
  const root = document.querySelector([
    '.scaffold-layout__main',
    'main[role="main"]',
    'main',
  ].join(', '));
  if (!root) return '';
  const clone = cleanProfileElement(root);
  clone.querySelectorAll('h1').forEach((heading) => {
    if (cleanProfileName(textOf(heading)) === name) heading.remove();
  });
  return cleanProfileMarkdown(Markdown.elementToMarkdown(clone));
}

function cleanProfileElement(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll([
    'script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside',
    'button', 'svg', 'img', '[role="dialog"]', '[role="menu"]',
    '.visually-hidden', '.artdeco-dropdown', '.artdeco-modal', '.modal',
    '[data-view-name*="overflow"]', '[data-testid*="overflow"]',
    '[class*="sign-in-modal"]', '[class*="contextual-sign-in"]',
    '[class*="authwall"]', '[class*="auth-button"]', '.linkedin-tc__text',
    'form', 'input', 'label',
  ].join(', ')).forEach((item) => item.remove());
  clone.querySelectorAll('.blurred_overlay__title').forEach((title) => title.parentElement?.remove());
  return clone;
}

function cleanProfileMarkdown(value: string): string {
  let previous = '';
  return value.split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*(?:[-*]\s*)?\[?(?:Show|See) all\b/i.test(line.trim()))
    .filter((line) => {
      const normalized = normalize(line);
      const duplicate = Boolean(normalized) && normalized === previous;
      previous = normalized;
      return !duplicate;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getLinkedInPersonData(): JsonObject | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const person = findPerson(JSON.parse(script.textContent || ''));
      if (person) return person;
    } catch {
      // Ignore unrelated or malformed structured data.
    }
  }
  return null;
}

function findPerson(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const person = findPerson(item);
      if (person) return person;
    }
    return null;
  }
  const object = asObject(value);
  if (!object) return null;
  const type = object['@type'];
  if (type === 'Person' || (Array.isArray(type) && type.includes('Person'))) return object;
  return findPerson(object['@graph']);
}

function personLocation(person: JsonObject | null): string {
  const address = asObject(person?.address);
  return [address?.addressLocality, address?.addressRegion, address?.addressCountry]
    .map(stringValue)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(', ');
}

function cleanProfileName(value: string): string {
  return normalize(value)
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s+-\s+[^|]+$/i, '')
    .trim() || 'LinkedIn Profile';
}

function cleanProfileDescription(value: string): string {
  return normalize(value)
    .replace(/\s*View .+? profile on LinkedIn.*$/i, '')
    .trim();
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}

function textOf(element: Element | null): string {
  return normalize(element?.textContent || '');
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? normalize(value) : '';
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return normalize(value);
  if (!Array.isArray(value)) return '';
  return value.map(stringValue).find(Boolean) || '';
}

function extractPost(url: string): string {
  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Post',
    url,
  };

  // Author
  const authorEl = document.querySelector('.update-components-actor__title .visually-hidden, .feed-shared-actor__name, .update-components-actor__name .hoverable-link-text');
  const author = authorEl?.textContent?.trim() || '';
  if (author) metadata.author = author;

  const parts: string[] = [];
  if (author) parts.push(`# Post by ${author}\n`);

  // Post text
  const textEl = document.querySelector('.feed-shared-update-v2__description .break-words, .feed-shared-text__text-view, .update-components-text');
  if (textEl) {
    const cleaned = Utils.removeNoise(textEl, ['script', 'style', 'button', 'svg', '[data-cam-instance]']);
    const body = Markdown.elementToMarkdown(cleaned).trim();
    if (body) {
      parts.push(body);
      parts.push('');
    }
  }

  // Reactions
  const reactionsEl = document.querySelector('.social-details-social-counts__reactions-count, .social-details-social-counts__count-value');
  const reactions = reactionsEl?.textContent?.trim() || '';
  if (reactions) parts.push(`**Reactions:** ${reactions}`);

  // Comments
  const commentEls = document.querySelectorAll('.comments-comment-item, .feed-shared-update-v2__comments-container .comments-comment-item');
  if (commentEls.length > 0) {
    parts.push(`\n## Comments (${commentEls.length})\n`);
    commentEls.forEach((comment) => {
      const commentAuthor = comment.querySelector(
        '.comments-post-meta__name-text, .comments-comment-meta__description-title, .comments-post-meta__profile-link',
      )?.textContent?.trim() || 'Anonymous';
      const commentBodyEl = comment.querySelector(
        '.comments-comment-item__main-content, .comments-comment-texteditor .feed-shared-text',
      );
      const commentText = commentBodyEl
        ? Markdown.elementToMarkdown(Utils.removeNoise(commentBodyEl, ['script', 'style', 'button', 'svg'])).trim()
        : '';
      if (commentText) {
        parts.push(`**${commentAuthor}:**`);
        parts.push(...commentText.split(/\r?\n/).map((line) => `> ${line}`), '');
      }
    });
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractArticle(url: string): string {
  const titleEl = document.querySelector('h1, .article-title');
  const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Article',
    title,
    url,
  };

  const authorEl = document.querySelector('.author-info__name, .article-author');
  if (authorEl) metadata.author = authorEl.textContent?.trim() || '';

  const articleBody = document.querySelector('.article-content, .reader-article-content, article');
  const body = articleBody
    ? Markdown.elementToMarkdown(Utils.removeNoise(articleBody, [...Utils.NOISE_SELECTORS, 'h1']))
    : '*No article content found.*';

  return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
}
