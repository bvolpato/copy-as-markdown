# Contributing

Bug reports and new extractors are welcome.

## Set up

Build with Node.js 22.22.2 and pnpm 11.22.0, to match CI.

```bash
git clone https://github.com/bvolpato/copy-as-markdown.git
cd copy-as-markdown
pnpm install
pnpm build
```

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build the userscript, both extensions, and the library in `dist/` |
| `pnpm typecheck` | Check types |
| `pnpm test:regression` | Run the offline browser tests that CI runs |
| `pnpm build:site` | Regenerate the homepage converter and the site lists |
| `pnpm package:all` | Create the extension ZIP files |
| `./install.sh` | Build and install a local extension or userscript |

### Installer options

```bash
./install.sh --type extension --browser chrome
./install.sh --type extension --browser firefox --local
./install.sh --type extension --browser chrome --copy-to "$HOME/.local/share/copy-as-markdown/chrome"
./install.sh --type userscript --browser brave --port 8787
```

`--copy-to` copies the unpacked extension to a new directory, and it does not overwrite an existing path. For userscripts, the installer serves the script on `127.0.0.1`. Press Ctrl+C when the installation is done. Use `--skip-build` to use existing `dist/` files and `--no-open` to print URLs only.

## Architecture

```
src/
├── core/
│   ├── types.ts        Extractor and anchor interfaces
│   ├── markdown.ts     HTML to Markdown converter
│   ├── ui.ts           Button injection: inline or floating
│   ├── utils.ts        DOM helpers, metadata, paywall detection
│   └── registry.ts     URL pattern to extractor routing
├── extractors/         One file for each site or platform
├── library/            Standalone library API and lazy loaders
├── catalog.ts          Imports every extractor without UI
├── background.ts       Extension toolbar action
├── site.ts             Converter entry for the homepage
└── main.ts             Extension and userscript entry point
build/
├── build.ts            Userscript, extension, and library bundles
├── site.ts             Homepage outputs
└── verify-release.ts   Release artifact checks
docs/                   Homepage, served by GitHub Pages
```

The build creates these outputs:

```
dist/
├── userscript/copy-as-markdown.user.js
├── chrome/             Manifest V3 extension
├── firefox/            Manifest V2 extension
└── library/            ESM entry, browser global, extractor chunks, and types
```

There are no runtime dependencies.

## Add a site

1. Create `src/extractors/my-site.ts`, and call `register()` in it.
2. Import the file in `src/catalog.ts`.
3. Add a loader in `src/library/loaders.ts`.
4. Add the site to `docs/sites.json`, and then run `pnpm build:site`.
5. Add a test case. Use a captured fixture for a public page and a synthetic fixture for a page that needs a login.
6. Run the checks in [Open a pull request](#open-a-pull-request).
7. Load the userscript or the extension, and check the real site.

```typescript
import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

export const mySiteExtractor = register({
  name: 'My Site',
  matches: ['*://www.mysite.com/*'],

  async extract() {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    const metadata = { source: 'My Site', title, url: Utils.getCanonicalUrl() };

    const content = document.querySelector('article') || document.querySelector('main');
    if (!content) return Markdown.buildPageMarkdown(metadata, '*No content found.*');

    const cleaned = Utils.removeNoise(content, Utils.NOISE_SELECTORS);
    const body = Markdown.elementToMarkdown(cleaned);
    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});
```

Guidelines:

- Leave out ads, menus, sidebars, and banners.
- Keep the structure. Use the `Markdown` helpers for tables, lists, and code.
- Include the source, title, URL, author, and date in the front matter.
- If content loads later, use `Utils.waitForElement()`.
- Check selectors on real pages. Do not guess them.
- Use strict TypeScript and imports. Do not add runtime dependencies.

## Button placement

The userscript button floats in the lower right corner by default. The extension uses the toolbar icon, and it shows page buttons only on Datadog dashboards, Datadog notebooks, and W&B runs.

An inline button needs an `anchor` and `buttonPlacement: 'anchor'`. Without the second setting, the `anchor` has no effect.

```typescript
buttonPlacement: 'anchor',
anchor: {
  selector: '#p-views ul',      // Target container
  position: 'append',           // 'append' | 'prepend' | 'before' | 'after' | 'overlay'
  style: 'tab',                 // 'tab' | 'pill' | 'icon' | 'link'
  wrapperTag: 'li',             // Optional wrapper when the host expects a child tag
  wrapperClass: 'mw-list-item', // Optional wrapper classes
  wrapperCss: { marginLeft: '8px' },
  css: { color: '#0645ad' },    // Optional button overrides
  label: 'Copy as Markdown',    // Omit for an icon-only button
},
```

| Style | Use it for | Example |
| --- | --- | --- |
| `tab` | A text navigation bar | Wikipedia |
| `pill` | Most sites | YouTube, Google Search |
| `icon` | An action bar that has only icons | X, WhatsApp |
| `link` | An action bar that has only text links | Reddit |

If the anchor is missing, scrolls out of view, or has no safe space beside it, the button floats until the inline position is usable again. Enable an inline button only after browser fixtures cover its selector and the navigation of the app.

## Tests

Browser tests and fixture tools use Puppeteer's `headless: 'shell'` mode with `chrome-headless-shell`, which runs without visible windows.

```bash
pnpm exec puppeteer browsers install chrome-headless-shell
pnpm test:regression
```

To use an existing headless shell installation, set `PUPPETEER_EXECUTABLE_PATH` to its executable path. Unset this variable if it points to regular Chrome. Tests launch their own browser and close it when finished.

Synthetic fixtures check routing and Markdown output without external network requests. Discussion and source-file cases check comment order, duplicate content, literal code, truncation warnings, and removal of action controls. These checks complement captured public pages; they do not establish current live coverage of authenticated applications.

### Captured public-site fixtures

Public extractors can be checked against browser-rendered pages without committing raw page data:

```bash
# Capture current public page in a clean headless browser.
# If live capture fails, try a Wayback snapshot.
pnpm fixtures:capture -- --site mdn

# Capture every curated public case, reporting failures without stopping early.
pnpm fixtures:capture -- --all

# Force one source while debugging.
pnpm fixtures:capture -- --site mdn --source live
pnpm fixtures:capture -- --site mdn --source wayback

# Replay committed fixtures entirely offline.
pnpm fixtures:verify
```

The [catalog](test/sites/catalog.yaml) contains anonymized public-page captures, including Hugging Face models, datasets, file trees, documentation references, and discussion threads. The [coverage inventory](test/sites/coverage.json) links the captures and retains historical public probes with their original timestamps. Capture checks the original copy button, extractor identity, placement, clipboard output, and `contentRequired` strings or `contentSelectors` before anonymizing the DOM. Bot challenges, login screens, and error pages fail capture.

Raw reference screenshots stay under gitignored `.fixture-work/`. Committed fixtures contain synthetic text, normalized links, no scripts or media, a screenshot of sanitized DOM, expected Markdown, and source provenance. `linkPrefixes` can retain curated public route prefixes for path-aware file extractors; link suffixes are still replaced.

A failed live attempt writes `live-failure.png` before Wayback fallback. Archive discovery tries CDX, then direct replay if CDX is unavailable. Accepted snapshots record the exact timestamp, digest, and downloaded-response SHA-256. Pin the accepted timestamp and digest in the catalog; set `digestAlgorithm: sha256` when pinning the response hash. Archived DOM is checked at the original URL with site scripts removed and outgoing requests blocked. An archive verifies historical content and markup; it does not prove current site placement or access.

Capture refuses credentials, localhost, private IP addresses, and non-HTTP protocols. Use only curated public URLs. Authenticated pages require synthetic fixtures and must never use this capture path.

Each captured fixture verifies extractor identity, exact anchor relationship, singleton UI, Markdown bounds, required output, synthetic markers for excluded page chrome, exact expected Markdown, and privacy rules. `pnpm test:regression` runs this offline lane in CI.

`pnpm test:live` runs optional diagnostics against Wayback snapshots. It is not a release gate, because the archive is not always available.

## Open a pull request

1. Fork the repository, and create a branch.
2. Make the change, and test it.
3. Run `pnpm typecheck && pnpm test:regression && pnpm package:all && pnpm verify:release && pnpm pack:library`.
4. Open a pull request that says which site or behavior changes.

## Report a problem

Include the URL, the browser, and the format that you use (userscript, Chrome, or Firefox). If the Markdown is wrong, include the result that you got and the result that you expected.

## Release process

GitHub Actions builds and publishes browser releases. Do not create releases or upload assets manually.

1. Update `package.json` to the next `MAJOR.MINOR.PATCH` version.
2. Merge the version and release changes into `main`.
3. Create and push a signed tag matching that version:

   ```bash
   version="$(node -p "require('./package.json').version")"
   git tag -s "v$version" -m "v$version"
   git push origin "v$version"
   ```

The release workflow accepts only signed strict semantic-version tags from an allowed signer. Tag version must match `package.json`, and tagged commit must be reachable from `main`. Workflow runs typechecking, browser regression tests, packaging, and manifest/archive verification before publishing GitHub and browser artifacts.

The workflow attests the verified release payloads with GitHub build provenance. For releases built with this workflow, download the assets and `SHA256SUMS` into one directory and run `sha256sum --check SHA256SUMS`. Verify the expected repository and release workflow for each downloaded archive or userscript:

```bash
gh attestation verify copy-as-markdown-chrome-vMAJOR.MINOR.PATCH.zip \
  --repo bvolpato/copy-as-markdown \
  --signer-workflow bvolpato/copy-as-markdown/.github/workflows/release.yml
```

Earlier releases have checksums but may not have build attestations.

Tag pushes do not publish to npm. To publish the scoped package explicitly, manually dispatch the Release workflow on the signed tag with `publish_npm=true`:

```bash
gh workflow run release.yml --ref "v$version" -f publish_npm=true
```

Run `pnpm pack:library` before publishing. npm trusted publishing must be configured for `release.yml`; the opt-in job uses OIDC provenance and publishes the same version as the signed tag.

### npm trusted publishing

The unscoped name `copy-as-markdown` is taken on npm, so this package is `@bvolpato/copy-as-markdown`. An npm owner must configure trusted publishing one time:

```bash
pnpm dlx npm@12.0.2 trust github @bvolpato/copy-as-markdown \
  --file release.yml \
  --repo bvolpato/copy-as-markdown \
  --allow-publish \
  --yes
```

The npm job skips versions that already exist. `prepack` rebuilds the library only, and the `files` list in `package.json` limits the package contents.
