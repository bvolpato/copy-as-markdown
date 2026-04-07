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

**Copy as Markdown** adds a context-aware button to websites you visit. Not a generic floating widget — the button appears **inline in each site's own UI**, right where you'd expect it:

- **Wikipedia** → A new tab next to *Read · Edit · View history*
- **X (Twitter)** → An icon in the tweet action bar, next to 🔖 and ↗️
- **YouTube** → A pill next to Like / Share / Download
- **Reddit** → A link in the post actions bar
- **News sites** → A pill below the article headline

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

| Site | Button Placement | What's Extracted |
| --- | --- | --- |
| **Wikipedia** | Tab bar (*Read · Edit · View history · **Copy as Markdown***) | Article body, tables, infoboxes — edit buttons and references stripped |
| **Grokipedia** | Header nav | Full article content with metadata |
| **Google Search** | Search tools bar | Query, featured snippets, knowledge panel, ranked results, "People Also Ask" |
| **Bing Search** | Scope bar | Query, search results, knowledge sidebar, related searches |
| **Reddit** | Post actions bar | Post title, body, subreddit, author, score, threaded comments with depth |
| **YouTube** | Like/Share action bar | Video title, channel, views, likes, description, chapters, comments, transcript |
| **WhatsApp Web** | Chat header (icon) | Chat name, all messages with sender, timestamp, media indicators |
| **X (Twitter)** | Tweet action bar (icon) | Single posts with replies, or full timelines with engagement stats |
| **Polymarket** | Below event header | Market title, description, outcome probabilities, volume, resolution rules |
| **News sites** | Below article headline | Fox News, CNN, BBC, NYT, Reuters, and 20+ others — article body, author, date; paywall detection |

Every extractor is purpose-built to separate **signal from noise**: no ads, no navigation menus, no cookie banners, no related-articles sidebars. Just the content that matters.

If the anchor element isn't found (e.g. site redesign), the button automatically falls back to a floating pill in the bottom-right corner.

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

Every major LLM — GPT-4, Claude, Gemini, Llama, Mistral — understands Markdown natively. It's the lingua franca of AI conversations.

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
│   ├── wikipedia.ts    ← anchor: tab bar
│   ├── grokipedia.ts   ← anchor: header nav
│   ├── google-search.ts← anchor: search tools bar
│   ├── bing.ts         ← anchor: scope bar
│   ├── reddit.ts       ← anchor: post actions
│   ├── youtube.ts      ← anchor: like/share bar
│   ├── whatsapp.ts     ← anchor: chat header (icon)
│   ├── polymarket.ts   ← anchor: below event header
│   ├── x-twitter.ts    ← anchor: tweet action bar (icon)
│   └── news.ts         ← anchor: below headline
└── main.ts             ← Entry point: detect site, show button
build/
└── build.js            ← esbuild bundler → userscript + extensions
```

### Anchor System

Each extractor defines an `anchor` config that tells the UI where to place the button:

```typescript
anchor: {
  selector: '#p-views ul',   // CSS selector for the target container
  position: 'append',        // 'append' | 'prepend' | 'before' | 'after'
  style: 'tab',              // 'tab' | 'pill' | 'icon' | 'link'
  css: { marginLeft: '8px' }, // Optional overrides to blend with the site
  label: 'Copy as Markdown',  // Custom label (omit for icon-only)
}
```

If the anchor selector isn't found, the button falls back to a floating FAB.

### Adding a New Site

1. Create `src/extractors/my-site.ts`
2. Import `register` from `../core/registry` and call it with `name`, `matches`, `anchor`, and `extract`
3. Import the new file in `src/main.ts`
4. Run `pnpm build` — the new patterns propagate to all targets

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

**Ideas for new extractors:**
- GitHub (issues, PRs, repos, READMEs)
- Stack Overflow (questions + answers)
- Hacker News (posts + comments)
- LinkedIn (posts, profiles)
- Amazon product pages
- Arxiv papers

---

## License

MIT © [Bruno Volpato](https://github.com/bvolpato)
