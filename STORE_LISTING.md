# Chrome Web Store — Store Listing

> Copy-paste reference for each field in the Chrome Web Store Developer Dashboard.

---

## Product Details

**Title:**
```
Copy as Markdown
```

**Summary:**
```
Context-aware "Copy as Markdown" button — the fastest way to share web content with LLMs like ChatGPT, Claude, and Gemini.
```

**Description:**
```
Copy as Markdown adds a smart floating button to every website. One click copies the page content as clean, structured Markdown — perfect for pasting into ChatGPT, Claude, Gemini, or any LLM.

🧠 WHY MARKDOWN?
When you copy-paste from a website, you lose all structure — headings become blobs, tables vanish, links disappear. Screenshots eat your token budget. Manually reformatting takes forever.

Copy as Markdown preserves everything: headers → #, tables → pipes, code → fenced blocks, links → [text](url). The result is 90%+ smaller than raw HTML while keeping full semantic structure.

🎯 24 FIRST-CLASS EXTRACTORS
Purpose-built extractors for the most popular sites:

• Wikipedia — article body, infoboxes, tables
• GitHub — issues, PRs, repos, README, code
• Stack Overflow — questions, answers, vote counts
• YouTube — title, description, chapters, transcript
• Reddit — posts, threaded comments with depth
• Hacker News — title, score, comment threads
• arXiv — papers with title, authors, abstract
• Medium — articles, author, claps, reading time
• Substack — newsletter posts, paywall detection
• Dev.to — articles, tags, reactions, comments
• MDN Web Docs — documentation, code examples, browser compat
• ChatGPT — shared conversations with role labels
• NPM — package info, README, dependencies
• PyPI — Python packages, version, description
• Google Search — query, snippets, knowledge panel
• Google Docs — full document export
• Bing Search — results, knowledge sidebar
• Amazon — product title, price, rating, reviews
• LinkedIn — profiles, posts, articles
• X (Twitter) — posts, replies, engagement stats
• Polymarket — market odds, resolution rules
• WhatsApp Web — chat messages with timestamps
• News sites (20+) — CNN, BBC, NYT, Reuters, and more

🌐 WORKS ON EVERY WEBSITE
Not on the list above? No problem. The smart fallback extractor works on any website — it detects the main content area (article, main, or selection) and converts it to Markdown automatically.

✨ KEY FEATURES
• One-click copy — floating button appears on every page
• Selection-aware — highlight text first to copy just that section
• YAML frontmatter — adds source, title, URL, and date metadata
• Dismiss per page — click the ✕ to hide the button for the current session
• Zero data collection — everything runs locally, nothing leaves your browser
• Lightweight — single JS file, no external dependencies

📋 PERFECT FOR
• Sharing web content with AI assistants (ChatGPT, Claude, Gemini)
• Research and note-taking in Markdown editors
• Developers copying documentation and code references
• Content curation and knowledge management

Open source: https://github.com/bvolpato/copy-as-markdown
```

**Category:**
```
Productivity
```

**Language:**
```
English
```

---

## Graphic Assets

**Store icon:** `dist/chrome/icons/icon-128.png` (128×128)

**Screenshots** (1280×800 or 640×400, JPEG or 24-bit PNG, no alpha):

> Generate these from the landing page or real usage. Suggested shots:

1. **Wikipedia** — The button anchored inline on a Wikipedia article, showing clean extraction
2. **GitHub** — The floating button on a GitHub repo page
3. **Clipboard output** — A text editor showing the Markdown output with YAML frontmatter
4. **Stack Overflow** — The button on a Stack Overflow question page
5. **Multiple sites** — A collage/grid showing the button on 6+ different sites

**Small promo tile** (440×280): Create from the icon + tagline "One click. Clean Markdown."

**Marquee promo tile** (1400×560): Create from hero section of landing page

---

## Additional Fields

**Homepage URL:**
```
https://bvolpato.github.io/copy-as-markdown/
```

**Support URL:**
```
https://github.com/bvolpato/copy-as-markdown/issues
```

**Mature content:** No (unchecked)

**Item support:** On

---

## Privacy

**Single purpose description:**
```
Extracts the content of the current web page and copies it to the clipboard as clean, structured Markdown text. The extension runs entirely locally — no data is sent to any server.
```

**activeTab justification:**
```
Required to read the current page's DOM content (text, headings, tables, links, code blocks) in order to convert it to Markdown when the user clicks the "Copy as Markdown" button. No data is read from any page until the user explicitly triggers the copy action. No data is sent externally.
```

**clipboardWrite justification:**
```
Required to write the generated Markdown text to the user's clipboard when they click the "Copy as Markdown" button. This is the core functionality of the extension — without clipboard access, the copied Markdown cannot be pasted into LLMs or text editors.
```

**Host permission justification:**
```
The extension uses <all_urls> in content_scripts to inject the floating "Copy as Markdown" button on every page. This is necessary because the extension is designed to work universally on any website — it has 24 site-specific extractors plus a smart fallback for all other sites. The content script only reads the page DOM when the user clicks the button; it does not passively collect or transmit any data.
```

**Are you using remote code?**
```
No, I am not using Remote code
```

**Remote code justification:**
```
All code is bundled into a single content.js file at build time using esbuild. No external scripts, modules, or eval() are used. The extension makes zero network requests.
```

---

## Data Usage

**What user data do you plan to collect?**

- [ ] Personally identifiable information — **No**
- [ ] Health information — **No**
- [ ] Financial and payment information — **No**
- [ ] Authentication information — **No**
- [ ] Personal communications — **No**
- [ ] Location — **No**
- [ ] Web history — **No**
- [ ] User activity — **No**
- [ ] Website content — **No**

> **Note on "Website content":** The extension reads DOM content locally to convert it to Markdown, but it does NOT collect, store, or transmit any website content. The Markdown is written only to the local clipboard. Check "No" for this field.

**Certifications (check all three):**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Privacy Policy

**Privacy policy URL:**
```
https://github.com/bvolpato/copy-as-markdown/blob/main/PRIVACY.md
```

> ⚠️ You need to create this file — see below.

---

## Payments

```
Free of charge
```

---

## Visibility

```
Public
```

---

## Test Instructions

**Username:** *(leave blank)*

**Password:** *(leave blank)*

**Additional instructions:**
```
No login required. Visit any website, look for the floating icon in the bottom-right corner, and click it. The page content will be copied as Markdown to your clipboard. Try it on wikipedia.org, github.com, or stackoverflow.com for the best experience.
```
