/**
 * PyPI package extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'PyPI',
  matches: [
    '*://pypi.org/project/*',
    '*://www.pypi.org/project/*',
    '*://test.pypi.org/project/*',
  ],

  async extract() {
    const url = Utils.getCanonicalUrl();
    const titleEl = document.querySelector('.project-header__name, .package-header__name');
    const titleText = titleEl?.textContent?.trim() || Utils.getPageTitle();
    const packageName = titleText.replace(/\s+\d+\.\d+.*$/, '').trim();
    const version = titleText.replace(packageName, '').trim();
    const descEl = document.querySelector('.project-header__summary, .package-description__summary');
    const description = descEl?.textContent?.trim() || '';

    const pipCommand = document.querySelector('#pip-command')?.textContent?.trim() || '';
    const license = extractSidebarField('License');
    const requiresPython = extractSidebarField('Requires');
    const author = extractSidebarField('Author') || extractSidebarField('Author-email');

    const metadata: Record<string, string> = { source: 'PyPI', package: packageName, url };
    if (version) metadata.version = version;
    if (license) metadata.license = license;
    if (requiresPython) metadata.requires_python = requiresPython;
    if (author) metadata.author = author;

    const heading = version ? `${packageName} ${version}` : packageName;
    const parts: string[] = [`# ${heading}\n`];
    if (description) parts.push(`${description}\n`);

    const meta: string[] = [];
    if (pipCommand) meta.push(`**Install:** \`${pipCommand}\``);
    if (author) meta.push(`**Author:** ${author}`);
    if (license) meta.push(`**License:** ${license}`);
    if (requiresPython) meta.push(`**Requires:** ${requiresPython}`);
    if (meta.length > 0) parts.push(`${meta.join(' · ')}\n`);

    const descriptionEl = document.querySelector('.project-description');
    if (descriptionEl) {
      const cleaned = Utils.removeNoise(descriptionEl, [...Utils.NOISE_SELECTORS, 'a.headerlink']);
      parts.push('## Description\n');
      parts.push(Markdown.elementToMarkdown(cleaned));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function extractSidebarField(label: string): string {
  const prefix = `${label.toLowerCase()}:`;
  const sections = document.querySelectorAll('.sidebar-section p, .vertical-tabs__panel p');
  for (const p of sections) {
    const strong = p.querySelector('strong');
    const strongText = strong?.textContent?.trim().toLowerCase() || '';
    if (strongText !== prefix) continue;
    const fullText = p.textContent?.replace(/\s+/g, ' ').trim() || '';
    const value = fullText.slice(strong?.textContent?.trim().length || 0).trim();
    if (value) return value;
  }
  return '';
}
