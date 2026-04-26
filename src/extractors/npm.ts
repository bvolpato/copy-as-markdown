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
  ],

  anchor: {
    selector: '#top .flex, #package-tab-readme, .fdbf4038',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('#top h1, h1 span[title]');
    const packageName = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const versionEl = document.querySelector('#top span[title]:not(h1 span), .f2874b88');
    const version = versionEl?.textContent?.trim() || '';

    const descEl = document.querySelector('#top p, .package-description-redundant, p.f2874b88');
    const description = descEl?.textContent?.trim() || '';

    // Weekly downloads
    const downloadsEl = document.querySelector('[class*="downloads"] p, ._9ba9a726');
    const downloads = downloadsEl?.textContent?.trim() || '';

    // License
    const licenseEl = document.querySelector('[class*="sidebar"] a[href*="license"], .ssc-8');
    const license = licenseEl?.textContent?.trim() || '';

    // Repository
    const repoEl = document.querySelector('[class*="sidebar"] a[href*="github.com"], a[aria-labelledby*="repository"]') as HTMLAnchorElement | null;
    const repoUrl = repoEl?.href || '';

    // Last publish
    const lastPublishEl = document.querySelector('[class*="sidebar"] time, time[datetime]');
    const lastPublish = lastPublishEl?.textContent?.trim() || lastPublishEl?.getAttribute('datetime')?.split('T')[0] || '';

    const metadata: Record<string, string> = {
      source: 'NPM',
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

    // README
    const readmeEl = document.querySelector('#readme, [id*="readme"] .markdown');
    if (readmeEl) {
      parts.push('## README\n');
      parts.push(Markdown.elementToMarkdown(readmeEl));
    }

    // Dependencies
    const depEls = document.querySelectorAll('#dependencies ul li a, [id*="dependencies"] a');
    if (depEls.length > 0) {
      const deps = Array.from(depEls).map(el => el.textContent?.trim()).filter(Boolean);
      if (deps.length) {
        parts.push(`\n## Dependencies (${deps.length})\n`);
        parts.push(deps.map(d => `- ${d}`).join('\n'));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
