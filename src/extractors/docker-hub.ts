/**
 * Docker Hub repository and official image extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const dockerHubExtractor = register({
  name: 'Docker Hub',
  matches: [
    '*://hub.docker.com/r/*/*',
    '*://hub.docker.com/_/*',
  ],
  pathnameRegex: /^\/(?:r\/[^/]+\/[^/]+|_\/[^/]+)(?:\/.*)?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="repository-name"], main h1, h2',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px', verticalAlign: 'middle' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="repository-name"], main h1, h1')?.textContent
        || Utils.getPageTitle().replace(/\s*-\s*Docker Hub$/i, ''),
    );
    const pullCmd = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="copy-pull-command"] input, [data-testid="copy-pull-command"], code')?.textContent
        || (document.querySelector<HTMLInputElement>('input[value^="docker pull"]')?.value || ''),
    );

    const metadata: PageMetadata = {
      source: 'Docker Hub',
      title,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# ${title}`];
    if (pullCmd && pullCmd.startsWith('docker pull')) {
      parts.push(`\n**Pull Command:** \`${pullCmd}\``);
    }

    const overview = document.querySelector('[data-testid="repository-overview"], .markdown-body, [class*="Markdown"], main article')
      || document.querySelector('main');
    if (overview) {
      const cleaned = Utils.removeNoise(overview, [...Utils.NOISE_SELECTORS, 'button', 'input']);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n## Overview\n\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Docker Hub page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
