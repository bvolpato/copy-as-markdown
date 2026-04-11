<p align="center">
  <img src="assets/icon.svg" width="120" alt="Copy as Markdown" />
</p>

<h1 align="center">Copy as Markdown</h1>

<p align="center">
  <strong>One click. Clean Markdown. Perfect LLM context.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> ·
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

**Copy as Markdown** adds a context-aware button to supported websites. The current positioning policy is intentionally conservative:

- **Wikipedia** → A new tab next to *Read · Edit · View history*
- **Everything else** → A floating button in the bottom-right corner

The codebase still keeps per-site hooks for inline placement, but we only enable them deliberately. Right now, Wikipedia is the only site opted into a custom position.

One click, and the page's content lands in your clipboard as clean, structured Markdown — headers, tables, links, code blocks, metadata — all preserved. Paste it into your LLM conversation. Done.

> 💡 **Structured Markdown is the most token-efficient, context-rich format for sharing web content with LLMs.** It preserves semantic meaning (headers = hierarchy, tables = data, links = sources) while stripping visual noise.

---

## Install

### 🔧 Userscript (Tampermonkey / Violentmonkey)

The fastest way to get started. Works in any browser with a userscript manager.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. **[Click here to install the userscript](https://raw.githubusercontent.com/bvolpato/copy-as-markdown/main/dist/userscript/copy-as-markdown.user.js)**
3. That's it — you'll see the button on supported sites

### 🟢 Chrome Extension

1. Download or clone this repository
2. Run `pnpm install && pnpm build`
3. Open `chrome://extensions/` → enable **Developer mode**
4. Click **Load unpacked** → select the `dist/chrome/` folder

### 🦊 Firefox Extension

1. Download or clone this repository
2. Run `pnpm install && pnpm build`
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** → select `dist/firefox/manifest.json`

---

## Supported Sites

Current button placement:

- **Wikipedia** uses an inline tab in the page chrome
- **All other supported sites** use the default floating button in the bottom-right corner

| Site | What's Extracted |
| --- | --- |
| **Wikipedia** | Article body, tables, infoboxes — edit buttons and references stripped |
| **Grokipedia** | Full article content with metadata |
| **Google Search** | Query, featured snippets, knowledge panel, ranked results, "People Also Ask" |
| **Bing Search** | Query, search results, knowledge sidebar, related searches |
| **Reddit** | Post title, body, subreddit, author, score, threaded comments with depth |
| **YouTube** | Video title, channel, views, likes, description, chapters, comments, transcript |
| **WhatsApp Web** | Chat name, all messages with sender, timestamp, media indicators |
| **X (Twitter)** | Single posts with replies, or full timelines with engagement stats |
| **Polymarket** | Market title, description, outcome probabilities, volume, resolution rules |
| **GitHub** | Issues & PRs (with comments, labels, state), repos (README, topics, languages), code files |
| **Stack Overflow** | Question with votes & tags, all answers (✅ accepted marked), comment threads |
| **Hacker News** | Post title, link, score, author, nested comment threads with depth |
| **LinkedIn** | Profiles (experience, education, about), posts (with reactions and comments), articles |
| **Amazon** | Product title, ASIN, price, rating, feature bullets, tech specs, reviews (top 10) |
| **arXiv** | Paper title, authors, abstract, subjects, DOI, links; full body from HTML pages |
| **News sites** | Fox News, CNN, BBC, NYT, Reuters, and 20+ others — article body, author, date; paywall detection |

Every extractor is purpose-built to separate **signal from noise**: no ads, no navigation menus, no cookie banners, no related-articles sidebars. Just the content that matters.

If an extractor is not explicitly opted into inline placement, the button stays in the bottom-right corner. If an inline anchor is enabled but the selector is missing (for example after a site redesign), the button also falls back to the bottom-right floating button.

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

Clicking the button on a Wikipedia article produces:

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
└── firefox/
    ├── manifest.json                   ← Firefox Manifest V2
    ├── content.js
    └── icons/
```

### Tech Stack

- **TypeScript** — all source code, compiled with esbuild
- **esbuild** — fast bundling into a single IIFE (no Webpack/Rollup)
- **pnpm** — package management
- **Zero runtime dependencies** — the output is a single self-contained JS file

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
│   ├── youtube.ts      ← extractor
│   ├── reddit.ts       ← extractor
│   ├── x-twitter.ts    ← extractor
│   └── news.ts         ← extractor
└── main.ts             ← Entry point: detect site, show button
build/
└── build.js            ← esbuild bundler → userscript + extensions
```

### Button Positioning

The default behavior is simple: unless a site is explicitly opted into inline placement, the button is rendered as a floating action button in the bottom-right corner.

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

This is the current policy in the repo:

- `Wikipedia` sets `buttonPlacement: 'anchor'`
- Every other extractor stays on the default floating placement, even if it already carries an `anchor` hook for future use

### Adding a New Site

1. Create `src/extractors/my-site.ts`
2. Import `register` from `../core/registry` and call it with `name`, `matches`, and `extract`
3. Leave the button floating by default unless you are intentionally enabling a reviewed inline placement
4. If you want to prepare an inline placement for later, add an `anchor` config but do not set `buttonPlacement: 'anchor'` yet
5. Import the new file in `src/main.ts`
6. Run `pnpm build` — the new patterns propagate to all targets

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

MIT © [Bruno Volpato](https://github.com/bvolpato)
