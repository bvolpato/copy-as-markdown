/**
 * NPM package extractor.
 * Extracts package name, version, description, readme, dependencies, and metadata.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'NPM',
  matches: [
    '*://www.npmjs.com/package/*',
    '*://npmjs.com/package/*',
  ],

  buttonPlacement: 'anchor',
  anchor: {
    selector: '#top h1, #top .flex, #package-tab-readme, .fdbf4038',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('#top h1, h1 span[title], main h1');
    const packageName = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const version = Array.from(document.querySelectorAll(
      '#top h1 ~ span, #top span[title]:not(h1 span), p.f2874b88',
    )).filter((element) => !element.closest('[data-cam-instance]'))
      .map((element) => element.textContent?.trim().match(/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?/)?.[0])
      .find(Boolean)
      || findSidebarFieldValue('Version')
      || '';

    // Never descend into #readme or sidebar metadata when locating the package description
    const descEl = Array.from(document.querySelectorAll(
      '.package-description-redundant, #top header p, #top > p, #top p',
    )).find((el) => !el.closest('#readme, [id*="readme"], .fdbf4038, [class*="sidebar"], aside, [data-cam-instance]'));
    const description = descEl?.textContent?.trim() || Utils.getMeta('description') || '';

    // Weekly downloads
    const downloadsEl = document.querySelector('[class*="downloads"] p, [aria-label*="downloads" i], ._9ba9a726');
    const downloads = downloadsEl?.textContent?.trim() || findSidebarFieldValue('Weekly Downloads') || '';

    // License
    const licenseEl = document.querySelector('[class*="sidebar"] a[href*="license"], .ssc-8');
    const license = licenseEl?.textContent?.trim() || findSidebarFieldValue('License') || '';

    // Repository (GitHub, GitLab, Bitbucket, Codeberg)
    const repoEl = document.querySelector<HTMLAnchorElement>([
      'a[aria-labelledby*="repository"]',
      '[class*="sidebar"] a[href*="github.com"]',
      '[class*="sidebar"] a[href*="gitlab.com"]',
      '[class*="sidebar"] a[href*="bitbucket.org"]',
      '[class*="sidebar"] a[href*="codeberg.org"]',
      '.fdbf4038 a[href*="github.com"]',
      '.fdbf4038 a[href*="gitlab.com"]',
      '.fdbf4038 a[href*="bitbucket.org"]',
      '.fdbf4038 a[href*="codeberg.org"]',
    ].join(', '));
    const repoUrl = repoEl?.href || findSidebarFieldLink('Repository') || '';

    // Last publish
    const lastPublishEl = document.querySelector('[class*="sidebar"] time, .fdbf4038 time, time[datetime]');
    const lastPublish = lastPublishEl?.textContent?.trim()
      || lastPublishEl?.getAttribute('datetime')?.split('T')[0]
      || '';

    const metadata: Record<string, string> = {
      source: 'NPM',
      title: packageName,
      package: packageName,
      url,
    };
    if (version) metadata.version = version;
    if (license) metadata.license = license;

    const parts: string[] = [`# ${packageName}\n`];
    if (description) parts.push(`${description}\n`);

    const meta: string[] = [];
    if (version) meta.push(`**Version:** ${version}`);
    if (downloads) meta.push(`**Downloads:** ${downloads}`);
    if (license) meta.push(`**License:** ${license}`);
    if (lastPublish) meta.push(`**Last Published:** ${lastPublish}`);
    if (repoUrl) meta.push(`**Repository:** ${repoUrl}`);
    if (meta.length) parts.push(meta.join(' · ') + '\n');

    // Keep the full rendered sidebar, including fields without stable selectors.
    const sidebar = document.querySelector('.fdbf4038, [class*="sidebar"], aside');
    if (sidebar) {
      parts.push('## Package Details\n');
      parts.push(Markdown.elementToMarkdown(Utils.removeNoise(sidebar, [
        'script', 'style', 'svg', 'canvas', 'button', 'form', '[data-cam-instance]',
      ])));
      parts.push('');
    }

    // README
    const readmeEl = document.querySelector('#readme, [id*="readme"] .markdown');
    if (readmeEl) {
      parts.push('## README\n');
      parts.push(Markdown.elementToMarkdown(readmeEl));
    }

    // Dependencies
    const depEls = document.querySelectorAll('#dependencies ul li a, [id*="dependencies"] a');
    if (depEls.length > 0) {
      const deps = Array.from(depEls).map((el) => el.textContent?.trim()).filter(Boolean);
      if (deps.length) {
        parts.push(`\n## Dependencies (${deps.length})\n`);
        parts.push(deps.map((d) => `- ${d}`).join('\n'));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function findSidebarFieldValue(label: string): string {
  const normalized = label.toLowerCase();
  const headings = document.querySelectorAll('.fdbf4038 h3, [class*="sidebar"] h3, aside h3');
  for (const heading of headings) {
    if (heading.textContent?.trim().toLowerCase() !== normalized) continue;
    const sibling = heading.nextElementSibling;
    const value = sibling?.textContent?.trim();
    if (value) return value;
  }
  return '';
}

function findSidebarFieldLink(label: string): string {
  const normalized = label.toLowerCase();
  const headings = document.querySelectorAll('.fdbf4038 h3, [class*="sidebar"] h3, aside h3');
  for (const heading of headings) {
    if (heading.textContent?.trim().toLowerCase() !== normalized) continue;
    const sibling = heading.nextElementSibling;
    const link = sibling?.matches('a[href]')
      ? sibling as HTMLAnchorElement
      : sibling?.querySelector<HTMLAnchorElement>('a[href]');
    if (link?.href) return link.href;
  }
  return '';
}
