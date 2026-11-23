/**
 * RubyGems.org extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const rubygemsExtractor = register({
  name: 'RubyGems',
  matches: [
    '*://rubygems.org/gems/*',
    '*://www.rubygems.org/gems/*',
  ],
  pathnameRegex: /^\/gems\/[^/?#]+(?:\/versions\/[^/?#]+)?\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: 'h1.page__heading, main h1, h1',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px', verticalAlign: 'middle' },
  },

  async extract() {
    const name = Markdown.normalizeWhitespace(
      document.querySelector('h1.page__heading a, h1.page__heading, main h1, h1')?.textContent
        || window.location.pathname.split('/')[2]
        || Utils.getPageTitle(),
    );
    const version = Markdown.normalizeWhitespace(
      document.querySelector('.page__subheading, h1.page__heading i, main h1 + span, main h1 + p')?.textContent || '',
    );
    const desc = Markdown.normalizeWhitespace(
      document.querySelector('.gem__desc p, .gem__desc, main header p')?.textContent || '',
    );

    const metadata: PageMetadata = {
      source: 'RubyGems',
      title: version && !name.includes(version) ? `${name} ${version}` : name,
      url: Utils.getCanonicalUrl(),
      version: version || undefined,
    };

    const parts: string[] = [`# ${metadata.title}`];
    if (desc) parts.push(`\n> ${desc}`);

    const gemfile = (document.querySelector<HTMLInputElement>('#gemfile_text')?.value || '').trim();
    const install = (document.querySelector<HTMLInputElement>('#install_text')?.value || '').trim();
    if (gemfile || install) {
      parts.push('\n## Installation\n');
      if (gemfile) parts.push(`- **Gemfile:** \`${gemfile}\``);
      if (install) parts.push(`- **CLI:** \`${install}\``);
    }

    const aside = document.querySelector('.gem__aside');
    if (aside) {
      const cleanedAside = Utils.removeNoise(aside, [...Utils.NOISE_SELECTORS, 'button', 'input', '.gem__code-wrap']);
      const asideMd = Markdown.elementToMarkdown(cleanedAside);
      if (asideMd) parts.push('\n## Details\n\n' + asideMd);
    }

    const deps = document.querySelector('.gem__members, #runtime_dependencies, .dependencies');
    if (deps) {
      const depsMd = Markdown.elementToMarkdown(Utils.removeNoise(deps, [...Utils.NOISE_SELECTORS, 'button']));
      if (depsMd) parts.push('\n## Dependencies\n\n' + depsMd);
    }

    if (!aside && !deps) {
      const main = document.querySelector('main') || document.body;
      const noiseWithoutHeader = Utils.NOISE_SELECTORS.filter((s) => s !== 'header');
      const cleaned = Utils.removeNoise(main, [...noiseWithoutHeader, 'h1', 'button', 'input', 'form']);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered RubyGems page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
