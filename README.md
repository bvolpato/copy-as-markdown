<p align="center">
  <img src="assets/icon.svg" width="120" alt="Copy as Markdown" />
</p>

<h1 align="center">Copy as Markdown</h1>

<p align="center">
  <strong>One click. Clean Markdown. Perfect LLM context.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#library">Library</a> ·
  <a href="#supported-sites">Supported Sites</a> ·
  <a href="#why">Why?</a> ·
  <a href="#build">Build</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## The Problem

You're chatting with ChatGPT, Claude, or Gemini. You want to share a web page for context — a Wikipedia article, a Reddit thread, a YouTube video, a news story. What do you do?

- **Copy-paste raw text** → Loses all structure. Headers become blobs. Tables vanish. Links disappear.
- **Share a URL** → The LLM can't browse it (or hallucinates what it says).
- **Screenshot** → Eats your token budget on image processing. Can't search or quote.
- **Manually reformat** → Life's too short.

## The Solution

**Copy as Markdown** allows you to extract content with a single click. Depending on your installation method, you interact with it in two ways:

- **Browser Extension:** Click the "Copy as Markdown" icon in your browser toolbar. Datadog dashboards, Datadog notebooks, and W&B runs also get a page button through narrowly scoped site access; extraction and clipboard writes still run only after a click.
- **Userscript:** A context-aware button is added to supported websites (e.g., a draggable floating button, or inline buttons on Wikipedia, Google Docs, Atlassian, and Datadog pages). Floating positions persist per site.

One click, and the page's content lands in your clipboard as clean, structured Markdown — headers, tables, links, code blocks, metadata — all preserved. Unicode compatibility forms, non-ASCII spaces, smart quotes, and dashes are normalized; invisible watermark and direction-control characters are removed. Paste it into your LLM conversation. Done.

> 💡 **Structured Markdown is the most token-efficient, context-rich format for sharing web content with LLMs.** It preserves semantic meaning (headers = hierarchy, tables = data, links = sources) while stripping visual noise.

---

## Install

### <img src="assets/icon.svg" width="20" alt=""> Userscript (Tampermonkey / Violentmonkey)

The fastest way to get started. Works in any browser with a userscript manager.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. **[Install Copy as Markdown](https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js)**
3. That's it — you'll see the button on supported sites

### <img src="docs/brands/chrome.svg" width="20" alt=""> Chrome Extension

[Install Copy as Markdown from the Chrome Web Store](https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol).

For local development:

1. Download or clone this repository
2. Run `pnpm install && pnpm build`
3. Open `chrome://extensions/` → enable **Developer mode**
4. Click **Load unpacked** → select the `dist/chrome/` folder

Chrome may show **Wants access to this site** on first use. Click **Allow**, then click **Copy as Markdown** again. The toolbar badge shows `…` while copying, `✓` on success, or `!` when the page or clipboard is unavailable.

### <img src="docs/brands/firefox.svg" width="20" alt=""> Firefox Extension

[Install Copy as Markdown from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/).

For local development:

1. Download or clone this repository
2. Run `pnpm install && pnpm build`
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** → select `dist/firefox/manifest.json`

The toolbar badge shows `…` while copying, `✓` on success, or `!` when the page or clipboard is unavailable.

### Site-owned button contract

Pages that already provide a copy control can suppress injected page UI with reserved ID:

```html
<button id="copy_as_markdown_btn">Copy as Markdown</button>
```

An empty marker works too:

```html
<div id="copy_as_markdown_btn"></div>
```

Adding or removing marker updates injected UI dynamically. Extension toolbar action remains available.

---

## Library

Install browser-safe ESM package with pnpm:

```bash
pnpm add @bvolpato/copy-as-markdown
```

Library loads only requested extractor chunks without starting userscript or extension UI. It does not inject buttons, write clipboard data, use extension APIs, or persist state. Fixed subpath imports let extension bundlers include only selected extractors.

### Extension content-script example

This matcher enables only Jira, Confluence, GitHub, and Google Docs. Domain list narrows broad built-in site patterns, and `when` adds DOM-specific policy owned by calling extension.

```typescript
import { createExtractorMatcher } from '@bvolpato/copy-as-markdown/core';
import { confluenceExtractor } from '@bvolpato/copy-as-markdown/extractors/confluence';
import { githubExtractor } from '@bvolpato/copy-as-markdown/extractors/github';
import { googleDocsExtractor } from '@bvolpato/copy-as-markdown/extractors/google-docs';
import { jiraExtractor } from '@bvolpato/copy-as-markdown/extractors/jira';

const matcher = createExtractorMatcher({
  extractors: [jiraExtractor, confluenceExtractor, githubExtractor, googleDocsExtractor],
  domains: [
    'jira.example.com',
    'confluence.example.com',
    'github.com',
    'docs.google.com',
    'acme.atlassian.net',
  ],
  when: ({ document, extractor }) => {
    if (extractor.name !== 'GitHub') return true;
    return Boolean(document?.querySelector('[data-my-extension-context]'));
  },
});

const match = matcher.match({
  url: window.location.href,
  document,
});

if (match) {
  const markdown = await match.extract();
  await navigator.clipboard.writeText(markdown);
}
```

`domains` uses exact hostnames. Use `*.atlassian.net` only when every Atlassian subdomain should be eligible. `origins` can restrict scheme and port. `urlPatterns` accepts userscript-style patterns or regular expressions. `when` receives parsed URL, current document, and matched extractor.

Runtime selection is also available when extractor set is not known at build time:

```typescript
import {
  createExtractorMatcher,
  loadExtractors,
} from '@bvolpato/copy-as-markdown';

const extractors = await loadExtractors(['jira', 'confluence', 'github', 'google-docs']);
const matcher = createExtractorMatcher({ extractors });
```

Site extractors run inside active page because authenticated Jira and Confluence extraction can use same-origin APIs and current browser state. Use generic DOM conversion for detached or caller-created DOM:

```typescript
import { domToMarkdown, htmlToMarkdown } from '@bvolpato/copy-as-markdown';

const fromElement = domToMarkdown(document.querySelector('main')!);
const fromDocument = domToMarkdown(new DOMParser().parseFromString(html, 'text/html'));
const fromHtml = htmlToMarkdown('<article><h1>Hello</h1></article>');
```

Custom extractors can be DOM-only. Pass empty URL patterns and inspect provided document:

```typescript
import { defineExtractor, domToMarkdown } from '@bvolpato/copy-as-markdown/core';

const internalApp = defineExtractor({
  name: 'Internal app',
  matches: [],
  detect: (document) => Boolean(document?.querySelector('[data-internal-app]')),
  extract: async () => domToMarkdown(document.querySelector('main')!),
});
```

Useful APIs:

- `getAvailableExtractorIds()` lists 50+ loadable extractor IDs.
- `loadExtractor('github')` loads one extractor chunk.
- `loadExtractors(['github', 'jira'])` loads selected chunks in parallel.
- `loadAllExtractors()` loads full catalog.
- `getExtractors()` lists extractors loaded in current module instance.
- `createExtractorMatcher()` applies extractor URL rules plus caller restrictions.
- `defineExtractor()` creates custom extractor objects for same matcher.
- `domToMarkdown()`, `elementToMarkdown()`, and `htmlToMarkdown()` convert caller-owned DOM without site UI.

---

## Supported Sites

**Interaction Model:**
- **Browser Extension:** Click the toolbar icon on any supported site, or the page button on Datadog dashboards, Datadog notebooks, and W&B runs.
- **Userscript:** Clicks are handled via injected buttons (inline where a site integration provides a reviewed anchor, floating otherwise). Drag floating buttons out of the way without disabling them; their positions persist per site.

| Site | What's Extracted |
| --- | --- |
| **Wikipedia** | Article body, tables, infoboxes — edit buttons and references stripped |
| **Google Docs** | Full document export via Google Docs HTML export — headings, lists, tables, links, images, and off-screen content |
| **Google Sheets** | Active sheet or selected range as a bounded Markdown table |
| **Google Slides** | Choose current slide or full deck; preserves order, titles, text, links, and speaker notes when available |
| **Gmail** | Full authenticated thread from Print all view — subject, participants, message headers, bodies, links, images, and attachments |
| **Notion** | Pages and databases with properties, rich blocks, tables, code, and rendered rows |
| **Documentation frameworks** | Mintlify, Docusaurus, GitBook, MkDocs, VitePress, Nextra, Sphinx, and Read the Docs on hosted or custom domains, with semantic content roots, navigation stripped, and code languages preserved |
| **Microsoft 365** | Word, Excel, and PowerPoint web content through structured live-page views |
| **Microsoft Teams** | Loaded chats, channels, and threads with authors, timestamps, replies, reactions, attachments, links, and code |
| **Slack** | Loaded channel or thread messages with authors, timestamps, reactions, replies, and attachments |
| **Discord** | Loaded channel messages and threads with authors, timestamps, replies, reactions, and attachments |
| **Jira** | Authenticated REST issue fields, ADF descriptions/comments, and links; rendered issue DOM fallback |
| **Linear** | Issues, projects, and documents with rendered properties, descriptions, links, and visible comments |
| **Confluence** | Authenticated REST page body, labels, tables, and code; visible comments and rendered DOM fallback |
| **Grokipedia** | Full article content with metadata |
| **Google Search** | Query, featured snippets, knowledge panel, ranked results, "People Also Ask" |
| **Bing Search** | Query, search results, knowledge sidebar, related searches |
| **DuckDuckGo Search** | Query, ranked results, snippets, destination links, and related searches |
| **Yahoo Search** | Query, ranked results, snippets, and destination links |
| **Yandex Search** | Query, answer cards, ranked results, and related searches |
| **Baidu Search** | Query, ranked results, abstracts, and destination links |
| **Brave Search** | Query, answer cards, ranked results, discussions, and related searches |
| **Reddit** | Post title, body, subreddit, author, score, threaded comments with depth |
| **YouTube** | Video title, channel, views, likes, description, chapters, comments, transcript |
| **WhatsApp Web** | Chat name, all messages with sender, timestamp, media indicators |
| **X (Twitter)** | Single posts with replies, or full timelines with engagement stats |
| **Polymarket** | Market title, description, outcome probabilities, volume, resolution rules |
| **OpenRouter** | Full model definitions, architecture, modalities, pricing, limits, supported parameters, benchmarks, provider endpoint fields, and FAQ |
| **Artificial Analysis** | Homepage featured items, analysis sections, complete published leaderboards, model overview, exact benchmark values, technical specifications, provenance, and FAQ |
| **DeepSWE** | Benchmark overview, all published leaderboard configurations and efficiency metrics, methodology, task examples, and blog sources |
| **Datadog dashboards** | Dashboard title, timeframe, template variables, grouped widget values, top lists, and visible chart annotations |
| **Datadog notebooks** | Notebook metadata, narrative headings and rich text, ordered visualization cells, types, no-data states, and visible chart annotations |
| **Datadog Documentation** | Authored `.md` source when available; cleaned rendered documentation DOM otherwise |
| **Weights & Biases** | Run metadata, configuration, numeric metric summaries, sparklines, and sampled history tables through W&B GraphQL |
| **MLflow** | Self-hosted run metadata plus chart-mode comparisons for visible runs and loaded metrics, with paginated metric-history tables through same-origin APIs |
| **Hugging Face** | Model, dataset, and Space repository metadata and tags, rendered model/dataset cards, Space descriptions, and visible file listings |
| **GitHub** | Issues and PRs, repository/directory listings with READMEs, full code-file contents, and canonical patches with commit/file metadata |
| **GitLab** | Repositories, trees, code files, issues, merge requests, comments, and visible diffs |
| **Bitbucket** | Repositories, source files, pull requests, issues, comments, and visible diffs |
| **Perplexity** | Ordered user and assistant turns with citations and source links |
| **Grok** | Ordered user and assistant turns with citations, code, and images |
| **ChatGPT** | Ordered user and assistant turns with Markdown, canvas writing blocks, code, model metadata, and images |
| **Claude** | Ordered user and assistant turns with Markdown, code, citations, and images |
| **Gemini** | Ordered user and model turns with Markdown, code, citations, and images |
| **Microsoft Copilot** | Consumer chats and shares with ordered turns, citations, code, files, images, and Copilot Pages when rendered |
| **Gemini Notebook / NotebookLM** | Current and legacy notebook chats with ordered grounded answers, source citations, files, and rendered Studio artifacts |
| **Mistral Vibe / Le Chat** | Chats with ordered turns, citations, files, code, images, workspace context, and rendered Canvas output |
| **DeepSeek** | Authenticated and shared chats with ordered user and assistant turns, citations, reasoning/code content, files, and images |
| **Google AI Studio** | Saved and new chat prompts with system instructions, ordered user/model turns, model metadata, grounding citations, code, files, and rendered artifacts |
| **Meta AI** | Ordered user and assistant turns with citations, code, and images |
| **LeetLLM** | Lessons, glossary pages, practice content, code, links, and learning context |
| **Stack Overflow** | Question with votes & tags, all answers (✅ accepted marked), comment threads |
| **Hacker News** | Post title, link, score, author, nested comment threads with depth |
| **LinkedIn** | Profiles (experience, education, about), posts (with reactions and comments), articles |
| **Facebook** | Posts, reels, captions, author metadata, engagement, and visible comments |
| **Instagram** | Posts and reels with captions, media descriptions, engagement, and visible comments |
| **TikTok** | Videos with creator, caption, engagement, transcript or captions, and visible comments |
| **Pinterest** | Pins with creator, description, destination, media, engagement, and visible comments |
| **VK** | Posts with author, timestamp, text, media, engagement, and visible comments |
| **Amazon** | Product title, ASIN, price, rating, feature bullets, tech specs, reviews (top 10) |
| **Temu** | Product title, price, availability, ratings, variants, specifications, and description |
| **Booking.com** | Hotels and search results with prices, scores, facilities, policies, and availability |
| **Netflix** | Title metadata, synopsis, cast, genres, ratings, seasons, and visible episodes |
| **Twitch** | Channels, live streams, videos, and clips with game, viewers, tags, and description |
| **Weather.com** | Current conditions, alerts, hourly outlook, and daily forecast |
| **arXiv** | Paper title, authors, abstract, subjects, DOI, links; full body from HTML pages |
| **Globo** | Articles and videos with headline, author, date, structured metadata, and clean body |
| **FOX** | Shows, episodes, movies, and videos with synopsis and structured details |
| **News sites** | Fox News, CNN, BBC, NYT, Reuters, and 20+ others — article body, author, date; paywall detection |

Every extractor is purpose-built to separate **signal from noise**: no ads, no navigation menus, no cookie banners, no related-articles sidebars. Just the content that matters.

AI chat extractors use rendered page content only and explicitly report visible-only coverage. When a product virtualizes history or exposes a load-older control, output also warns that older content was not loaded.

W&B returns up to 500 sampled history rows per run through its browser GraphQL API. MLflow run history fetches are paginated up to 10,000 points per metric. MLflow chart comparisons include up to 10 visible runs and 50 loaded run-metric series, fetching up to 2,500 points per series. Both integrations include full-series statistics, then evenly sample Markdown history rows when needed to keep clipboard output bounded. W&B Server and arbitrary self-hosted MLflow deployments work through userscript content detection or extension toolbar; their active browser session must permit same-origin API access.

If an extractor is not explicitly opted into inline placement (for userscript builds), the button stays in the bottom-right corner. If an inline anchor is enabled but the selector is missing (for example after a site redesign), the button also falls back to the bottom-right floating button.

---

## Why Markdown for LLMs?

### 1. Structure = Understanding

```
# Vigenère Cipher                      ← LLM knows: this is the topic
## History                              ← LLM knows: this is a section about history
| Inventor | Blaise de Vigenère |       ← LLM knows: structured key-value data
```

The LLM doesn't have to *guess* what's a heading vs. body text vs. metadata. Markdown makes the hierarchy explicit.

### 2. Token Efficiency

Raw HTML from a typical Wikipedia article: **~200K characters**.
Copy as Markdown output: **~15K characters**.

That's **>90% noise reduction** — more room for your actual conversation.

### 3. Faithful Reproduction

- **Headers** → `#`, `##`, `###` (hierarchy preserved)
- **Tables** → Pipe-delimited Markdown tables (data preserved)
- **Code blocks** → Fenced with language tags (syntax preserved)
- **Links** → `[text](url)` (sources preserved)
- **Lists** → Nested bullets/numbers (structure preserved)

### 4. Universal Compatibility

Every major LLM — GPT-5.4, Claude, Gemini, Llama, Mistral — understands Markdown natively. It's the lingua franca of AI conversations.

---

## Example Output

Clicking the extension icon or userscript button on a Wikipedia article produces:

```markdown
---
source: Wikipedia
title: Vigenère cipher
url: https://en.wikipedia.org/wiki/Vigen%C3%A8re_cipher
last_modified: 15 March 2025
---

# Vigenère cipher

The **Vigenère cipher** is a method of encrypting alphabetic text
where each letter of the plaintext is encoded with a different
Caesar cipher, whose increment is determined by the corresponding
letter of another text, the **key**.

## History

The Vigenère cipher is simple enough to be a field cipher if it
is used in conjunction with cipher disks...

## Description

| Component | Details |
| --- | --- |
| Type | Polyalphabetic substitution |
| Key | A repeating keyword |
| Inventor | Blaise de Vigenère |
```

---

## Build

```bash
# Clone the repository
git clone https://github.com/bvolpato/copy-as-markdown.git
cd copy-as-markdown

# Install dependencies
pnpm install

# Type-check
pnpm typecheck

# Build all targets
pnpm build

# Package extensions as .zip
pnpm package:all
```

### Output

```
dist/
├── userscript/
│   └── copy-as-markdown.user.js       ← Install directly in Tampermonkey
├── chrome/
│   ├── manifest.json                   ← Chrome Manifest V3
│   ├── content.js
│   └── icons/
├── firefox/
│   ├── manifest.json                   ← Firefox Manifest V2
│   ├── content.js
│   └── icons/
└── library/
    ├── index.js                        ← Browser-safe ESM package entry
    ├── browser.js                      ← CopyAsMarkdown browser global
    ├── chunks/                         ← Lazy site extractor chunks
    ├── extractors/                     ← Fixed Jira, Confluence, GitHub, Hugging Face, Google Docs entries
    └── types/                          ← TypeScript declarations
```

### Publish library

Unscoped `copy-as-markdown` name is already used on npm. This repository publishes as public scoped package `@bvolpato/copy-as-markdown`.

Validate exact package contents without publishing:

```bash
pnpm pack:library
```

Releases are driven by signed `vMAJOR.MINOR.PATCH` tags on `main`. The release workflow validates the tag, tests and packages every target, then creates the GitHub release and browser artifacts. Tag pushes do not publish to npm.

To publish the npm package explicitly, manually run the Release workflow on the signed tag and enable its `publish_npm` input. The input defaults to `false`.

npm trusted publishing requires one-time package configuration by an npm owner:

```bash
pnpm dlx npm@12.0.2 trust github @bvolpato/copy-as-markdown \
  --file release.yml \
  --repo bvolpato/copy-as-markdown \
  --allow-publish \
  --yes
```

After this one-time setup, an explicitly enabled npm job uses OIDC trusted publishing and provenance without a long-lived token. Existing package versions are detected and skipped. `prepack` rebuilds standalone library without touching extension or userscript artifacts. `files` allowlist publishes only standalone library, declarations, README, license, and package manifest.

### Tech Stack

- **TypeScript** — all source code, compiled with esbuild
- **esbuild** — fast userscript, extension, ESM, and browser-global bundling
- **pnpm** — package management
- **Zero runtime dependencies** — extension targets are self-contained; library uses local ESM chunks only

---

## Architecture

```
src/
├── core/
│   ├── types.ts        ← AnchorConfig, ExtractorConfig, PageMetadata interfaces
│   ├── markdown.ts     ← HTML→Markdown converter (tables, lists, code, etc.)
│   ├── ui.ts           ← Button injection: anchored (inline) or floating (FAB)
│   ├── utils.ts        ← DOM helpers, meta extraction, paywall detection
│   └── registry.ts     ← URL pattern → extractor mapping
├── extractors/
│   ├── wikipedia.ts    ← extractor with active inline placement
│   ├── google-docs.ts  ← extractor with active inline placement
│   ├── datadog-dashboard.ts ← semantic dashboard extractor + toolbar placement
│   ├── datadog-notebook.ts ← structured notebook extractor + toolbar placement
│   ├── youtube.ts      ← extractor
│   ├── reddit.ts       ← extractor
│   ├── x-twitter.ts    ← extractor
│   └── news.ts         ← extractor
├── catalog.ts          ← Load extractors without UI startup
├── library/index.ts    ← Standalone matcher and DOM API
└── main.ts             ← Entry point: detect site, show button
build/
└── build.ts            ← esbuild bundler → userscript + extensions + library
```

### Userscript Button Positioning

*Note: Button positioning only applies to the Userscript build. The browser extensions rely exclusively on the toolbar icon.*

The default behavior is simple: unless a site is explicitly opted into inline placement, the userscript button is rendered as a floating action button in the bottom-right corner.

To enable a custom inline position for a specific site, you need two things:

1. An `anchor` config that describes where and how to inject the button
2. `buttonPlacement: 'anchor'` on the extractor

That second step is the gate. It lets us keep site-specific selectors in the codebase without turning them on until we're ready.

```typescript
register({
  name: 'Wikipedia',
  matches: ['*://*.wikipedia.org/wiki/*'],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#p-views ul',
    position: 'append',
    style: 'tab',
    css: {
      marginLeft: '8px',
      paddingLeft: '8px',
      borderLeft: '1px solid #a2a9b1',
    },
    label: 'Copy as Markdown',
  },
  async extract() {
    // ...
  },
});
```

The `anchor` object controls the inline position:

```typescript
anchor: {
  selector: '#p-views ul',   // CSS selector for the target container
  position: 'append',        // 'append' | 'prepend' | 'before' | 'after'
  style: 'tab',              // 'tab' | 'pill' | 'icon' | 'link'
  wrapperTag: 'li',          // Optional wrapper when the host expects a specific child tag
  wrapperClass: 'mw-list-item', // Optional wrapper classes
  wrapperCss: { marginLeft: '8px' }, // Optional wrapper overrides
  css: { color: '#0645ad' },  // Optional button overrides
  label: 'Copy as Markdown',  // Custom label (omit for icon-only)
}
```

Use `wrapperTag` / `wrapperClass` / `wrapperCss` when the host container expects a particular DOM shape. Wikipedia is the main example: the tab bar is a `ul`, so the injected control needs to live inside an `li` to align correctly with the native tabs.

Positioning rules:

- Omit `buttonPlacement`, or set it to `'floating'`, to keep the default bottom-right button
- Add `buttonPlacement: 'anchor'` to activate the extractor's `anchor` config
- If the anchor selector is missing at runtime, the UI falls back to the bottom-right floating button

Extractors enable anchored placement only after their site selector and SPA lifecycle are covered by browser fixtures. Others retain floating placement.

### Adding a New Site

1. Create `src/extractors/my-site.ts`
2. Import `register` from `../core/registry` and call it with `name`, `matches`, and `extract`
3. Leave the button floating by default unless you are intentionally enabling a reviewed inline placement
4. If you want to prepare an inline placement for later, add an `anchor` config but do not set `buttonPlacement: 'anchor'` yet
5. Import the new file in `src/main.ts`
6. Run `pnpm build` — the new patterns propagate to all targets

### Captured Public-Site Fixtures

Public extractors can be checked against browser-rendered pages without committing raw page data:

```bash
# Capture current public page in a clean headless browser.
# If live capture fails, use an exact Wayback CDX capture.
pnpm fixtures:capture -- --site mdn

# Force one source while debugging.
pnpm fixtures:capture -- --site mdn --source live
pnpm fixtures:capture -- --site mdn --source wayback

# Replay committed fixtures entirely offline.
pnpm fixtures:verify
```

Catalog lives at `test/sites/catalog.yaml`. Capture writes raw reference screenshots only under gitignored `.fixture-work/`. A failed live attempt writes `live-failure.png` before Wayback fallback. Committed fixtures contain synthetic text, normalized links, no scripts or media, a screenshot of sanitized DOM, expected Markdown, and source provenance. Wayback provenance includes exact capture timestamp and digest. Set `wayback: true` to discover a capture through CDX, then pin accepted timestamp and digest in catalog for stable replay.

Capture refuses credentials, localhost, private IP addresses, and non-HTTP protocols. Use only curated public URLs. Authenticated pages require synthetic fixtures and must never use this capture path.

Each captured fixture verifies extractor identity, exact anchor relationship, singleton UI, Markdown bounds, required output, synthetic markers for excluded page chrome, exact expected Markdown, and privacy rules. `pnpm test:regression` runs this offline lane in CI.

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

MIT © [Bruno Volpato](https://github.com/bvolpato)
