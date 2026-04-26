/**
 * PyPI package extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'PyPI',
  matches: ['*://pypi.org/project/*'],

  async extract() {
    const url = Utils.getCanonicalUrl();
    const titleEl = document.querySelector('.package-header__name, h1.package-header__name');
    const titleText = titleEl?.textContent?.trim() || Utils.getPageTitle();
    const packageName = titleText.replace(/\s+\d+\.\d+.*$/, '').trim();
    const version = titleText.replace(packageName, '').trim();
    const descEl = document.querySelector('.package-description__summary');
    const description = descEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = { source: 'PyPI', package: packageName, url };
    if (version) metadata.version = version;

    const parts: string[] = [`# ${packageName} ${version}\n`];
    if (description) parts.push(`${description}\n`);

    const descriptionEl = document.querySelector('.project-description');
    if (descriptionEl) {
      parts.push('## Description\n');
      parts.push(Markdown.elementToMarkdown(descriptionEl));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
