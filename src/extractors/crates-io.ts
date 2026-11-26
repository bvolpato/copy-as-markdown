/**
 * crates.io (Rust package registry) extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const cratesIoExtractor = register({
  name: 'crates.io',
  matches: [
    '*://crates.io/crates/*',
    '*://www.crates.io/crates/*',
  ],
  pathnameRegex: /^\/crates\/[^/?#]+(?:\/[^/?#]+)*\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: 'main h1, header h1',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px', verticalAlign: 'middle' },
  },

  async extract() {
    const heading = document.querySelector('[data-test-heading], main h1');
    const name = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-heading] h1, main h1')?.textContent
        || window.location.pathname.split('/')[2]
        || Utils.getPageTitle(),
    );
    const version = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-heading] small, [data-test-crate-version]')?.textContent || '',
    );
    const description = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-description], main .header .description, [class*="description"] p')?.textContent || '',
    );

    const metadata: PageMetadata = {
      source: 'crates.io',
      title: version ? `${name} ${version}` : name,
      url: Utils.getCanonicalUrl(),
      version: version || undefined,
    };

    const parts: string[] = [`# ${metadata.title}`];
    if (description) parts.push(`\n> ${description}`);

    const details: string[] = [];
    const installCode = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-install] code, [class*="install"] code, .install-instructions .selectable')?.textContent || '',
    );
    if (installCode) details.push(`**Install:** \`${installCode}\``);

    const license = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-license], [data-test-metadata-license], .metadata .license')?.textContent || '',
    ).replace(/^License:\s*/i, '');
    if (license) details.push(`**License:** ${license}`);

    const msrv = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-msrv], .metadata .msrv')?.textContent || '',
    ).replace(/^Minimum Rust version:\s*/i, '');
    if (msrv) details.push(`**MSRV:** ${msrv}`);

    // README links can also point to docs.rs, so prefer the sidebar link.
    const docsLink = document.querySelector<HTMLAnchorElement>('[data-test-docs-link] a')
      || findSidebarLink('Documentation')
      || document.querySelector<HTMLAnchorElement>('a[href*="docs.rs"]');
    if (docsLink?.href) details.push(`**Docs:** ${docsLink.href}`);

    const repoLink = document.querySelector<HTMLAnchorElement>('[data-test-repository-link] a')
      || findSidebarLink('Repository');
    if (repoLink?.href) details.push(`**Repository:** ${repoLink.href}`);

    if (details.length > 0) parts.push('\n' + details.join(' | '));

    const readmeEl = document.querySelector('[data-test-readme], article[class*="readme"], main article');
    if (readmeEl) {
      const cleaned = Utils.removeNoise(readmeEl, [...Utils.NOISE_SELECTORS, 'button']);
      const readmeMd = Markdown.elementToMarkdown(cleaned);
      if (readmeMd) parts.push('\n## README\n\n' + readmeMd);
    } else if (heading) {
      const mainEl = document.querySelector('main');
      if (mainEl) {
        const cleaned = Utils.removeNoise(mainEl, [...Utils.NOISE_SELECTORS, 'button', 'aside']);
        const body = Markdown.elementToMarkdown(cleaned);
        if (body) parts.push('\n' + body);
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered crates.io page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

function findSidebarLink(heading: string): HTMLAnchorElement | null {
  const title = Array.from(document.querySelectorAll('.sidebar h2'))
    .find((element) => element.textContent?.trim() === heading);
  return title?.parentElement?.querySelector<HTMLAnchorElement>('a[href]') || null;
}
