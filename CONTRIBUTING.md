# Contributing to Copy as Markdown

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/bvolpato/copy-as-markdown.git
cd copy-as-markdown
pnpm install
pnpm build
```

## Adding a New Site Extractor

1. **Create the extractor file** at `src/extractors/my-site.ts`
2. **Register it** using `register()`:

```typescript
import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'My Site',
  matches: [
    '*://www.mysite.com/*',
  ],
  // Default behavior: floating button in the bottom-right corner.
  // Only add buttonPlacement: 'anchor' when an inline position is
  // explicitly reviewed and ready to be enabled.
  anchor: {
    selector: 'header nav',        // where to put the button
    position: 'append',            // 'append' | 'prepend' | 'before' | 'after' | 'overlay'
    style: 'pill',                 // 'tab' | 'pill' | 'icon' | 'link'
  },

  async extract() {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    const url = Utils.getCanonicalUrl();

    const metadata = { source: 'My Site', title, url };

    const content = document.querySelector('article') || document.querySelector('main');
    if (!content) return Markdown.buildPageMarkdown(metadata, '*No content found.*');

    const cleaned = Utils.removeNoise(content, Utils.NOISE_SELECTORS);
    const body = Markdown.elementToMarkdown(cleaned);

    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});
```

3. **Import in main.ts**: Add `import './extractors/my-site';` to `src/main.ts`
4. **Build and test**: `pnpm typecheck && pnpm test:regression && pnpm package:all && pnpm verify:release`
5. **Load the userscript** or extension and verify on the target site

`pnpm test:live` runs optional Wayback-based diagnostics. It is not a release gate because archive availability is external and intermittent.

By default, the button should stay floating in the bottom-right corner. If you want to activate an inline placement, set:

```typescript
buttonPlacement: 'anchor'
```

Without that flag, any `anchor` config is treated as a dormant hook for later.

## Anchor Style Guide

| Style | When to use | Example |
| --- | --- | --- |
| `tab` | Site has a text-based nav bar | Wikipedia |
| `pill` | General purpose, compact gradient button | YouTube, Google Search |
| `icon` | Space-constrained action bars with icon buttons | X/Twitter, WhatsApp |
| `link` | Text-heavy action bars (uppercase links) | Reddit |

If unsure, use `pill` — it's the most versatile and always looks good.

## Extractor Guidelines

- **Separate signal from noise.** Strip ads, nav, sidebars, cookie banners.
- **Preserve structure.** Use the `Markdown` helpers for tables, lists, code blocks.
- **Include metadata.** Source name, title, URL, author, date — as YAML frontmatter.
- **Handle SPAs.** Use `Utils.waitForElement()` if content loads dynamically.
- **Test with real pages.** Don't just guess at selectors — verify them.

## Code Style

- TypeScript with strict mode
- No runtime dependencies
- Use proper imports, not globals
- Keep extractors focused — one file per site

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b add-github-extractor`
3. Make your changes and test them
4. Run `pnpm typecheck && pnpm test:regression && pnpm package:all && pnpm verify:release`
5. Open a PR with a clear description of what site you're adding and what content is extracted

## Release Process

GitHub Actions builds and publishes releases. Do not create releases or upload assets manually.

1. Update `package.json` to the next `MAJOR.MINOR.PATCH` version.
2. Merge the version and release changes into `main`.
3. Create and push a signed tag matching that version:

   ```bash
   version="$(node -p "require('./package.json').version")"
   git tag -s "v$version" -m "v$version"
   git push origin "v$version"
   ```

The release workflow accepts only signed strict semantic-version tags from an allowed signer. Tag version must match `package.json`, and tagged commit must be reachable from `main`. Workflow runs typechecking, browser regression tests, packaging, and manifest/archive verification before its isolated publish job receives write permission.

## Reporting Issues

- Include the URL where the button doesn't appear or doesn't work
- Note which format you're using (userscript, Chrome, Firefox)
- If the Markdown output is wrong, share a sample of what you got vs. what you expected
