# Extension Store Listings

> Chrome uses concise metadata for policy compliance. Firefox retains detailed compatibility information.

---

## Chrome Web Store

### Product Details

**Title:**
```
Copy as Markdown
```

**Summary:**
```
Copy page content as clean, structured Markdown for notes, research, documentation, and AI workflows.
```

**Description:**
```
Copy as Markdown converts the current page or selected content into clean Markdown and writes it to your clipboard.

It preserves useful structure such as headings, links, lists, tables, code blocks, and source metadata. Site-aware extraction improves results on supported page types, while a general fallback handles other pages.

FEATURES
• Copy a full page or selected content
• Preserve document structure, links, tables, and code
• Include source metadata in YAML frontmatter
• Use one click from the toolbar or an inline control
• Process content in your browser
• No ads, analytics, account, or developer-operated data service

PRIVACY
The extension does not send page content, generated Markdown, or usage analytics to the developer. Some supported authenticated pages are read through that site's own HTTPS endpoints using your existing browser session. Data is processed in memory and written only to your clipboard.

Source code and compatibility details:
https://github.com/bvolpato/copy-as-markdown
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

### Graphic Assets

**Store icon:** `dist/chrome/icons/icon-128.png` (128×128)

**Screenshots** (1280×800 or 640×400, JPEG or 24-bit PNG, no alpha):

Upload these 3 images from `docs/screenshots/`:

1. `1-wikipedia.png` — Wikipedia article showing the Copy as Markdown extension
2. `2-github.png` — GitHub repo page with the copy success toast notification
3. `3-before-after.png` — Side-by-side: messy copy-paste vs clean Markdown output

Do not upload `5-all-sites.png`. Its multi-site grid can look like brand or keyword stuffing.

**Small promo tile** (440×280): Create from the icon + tagline "One click. Clean Markdown."

**Marquee promo tile** (1400×560): Create from hero section of landing page

---

### Additional Fields

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

### Privacy

**Single purpose description:**
```
Converts content from the current web page into structured Markdown and writes it to the user's clipboard.
```

**activeTab justification:**
```
Required to inject the extraction script and read content from the active page after the user clicks the extension icon. The extension converts page text, headings, tables, links, and code blocks into Markdown. Extracted content is not sent to the developer or unrelated third parties.
```

**scripting justification:**
```
Required to execute the packaged extraction script in the active tab after the user clicks the extension icon. Separately scoped content scripts place inline controls on supported routes; extraction still starts only after a user action.
```

**clipboardWrite justification:**
```
Required to write generated Markdown to the user's clipboard. Clipboard output is the extension's single purpose.
```

**Datadog site access justification:**
```
Required only on dashboard and notebook routes under datadoghq.com, datadoghq.eu, and ddog-gov.com. Access places an inline control and, after a user click, reads dashboard or notebook definitions and metric series from Datadog's same-origin HTTPS APIs using the user's existing session. Responses are processed in the browser and are not sent to the developer or unrelated third parties.
```

**Are you using remote code?**
```
No, I am not using Remote code
```

**Remote code justification:**
```
All executable code ships in the extension package. No external scripts, dynamic code, eval(), or remote modules are loaded. Supported extractors may request page data from the current site's own HTTPS endpoints; responses are data, not executable code.
```

---

### Data Usage

**What user data do you plan to collect?**

- [ ] Personally identifiable information — **No**
- [ ] Health information — **No**
- [ ] Financial and payment information — **No**
- [ ] Authentication information — **No**
- [x] Personal communications — **Yes**; only when content selected by the user includes conversations
- [ ] Location — **No**
- [x] Web history — **Yes**; the current page URL is included as source metadata
- [ ] User activity — **No**
- [x] Website content — **Yes**; required to convert the current page or selection to Markdown

> **Disclosure note:** Chrome defines local processing as handling user data. The extension handles current-page content, its URL, and any conversations the user explicitly chooses to convert. This data is used only to generate Markdown, is not retained, and is not sent to the developer or unrelated third parties. Supported extractors may retrieve content from the current site's own HTTPS endpoints using the user's existing browser session.

**Certifications (check all three):**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

### Privacy Policy

**Privacy policy URL:**
```
https://bvolpato.github.io/copy-as-markdown/privacy.html
```

---

### Payments

```
Free of charge
```

---

### Visibility

```
Public
```

---

### Test Instructions

**Username:** *(leave blank)*

**Password:** *(leave blank)*

**Additional instructions:**
```
No login is required for general use. Open a public article or documentation page, click the Copy as Markdown extension icon, and paste into a text editor to verify structured Markdown output. Selecting part of the page before clicking should copy only that selection. Authenticated integrations can be tested with the reviewer's own account.
```

---

### Appeal Draft

```text
This appeal requests review of a corrected revision. It does not claim that the cited description was acceptable.

I removed the long list of websites, brands, and feature keywords identified under violation reference Yellow Argon. I also removed repeated brand references and rewrote the listing around the extension's single purpose: converting content from the current page into Markdown and copying it to the clipboard.

The revised description contains no supported-site inventory or search-oriented keyword list. Full compatibility details remain in the linked project documentation. I also reviewed screenshot guidance and privacy text so the listing accurately describes current behavior.

Please review the corrected revision for item pcjanmkidppaeojkanbjbmmgpjfeecol.
```

---

## Firefox Add-ons

**Add-on URL:**
```
https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/
```

### Product Details

**Title:**
```
Copy as Markdown
```

**Summary:**
```
Context-aware Markdown extraction for articles, documentation, dashboards, conversations, code, and more.
```

**Description:**
```
Copy as Markdown converts web content into clean, structured Markdown with one click. It preserves headings, tables, links, code blocks, lists, and source metadata for AI workflows, research, notes, and documentation.

28 FIRST-CLASS EXTRACTORS

• Wikipedia: article body, infoboxes, and tables
• GitHub: issues, pull requests, repositories, README files, and code
• Stack Overflow: questions, answers, vote counts, and comments
• YouTube: title, description, chapters, comments, and transcript
• Reddit: posts and threaded comments
• Hacker News: title, score, and nested comments
• arXiv: paper title, authors, abstract, and HTML body
• Medium: articles, author, publication, claps, and reading time
• Substack: newsletter posts, author, likes, and paywall state
• Dev.to: articles, tags, reactions, and comments
• MDN Web Docs: documentation, examples, and compatibility tables
• ChatGPT: shared conversations with role labels
• Claude: conversations with role labels
• Gemini: conversations with role labels
• NPM: package metadata, README, downloads, and dependencies
• PyPI: package metadata, description, and README
• Google Search: query, snippets, knowledge panel, and ranked results
• Google Docs: document export with headings, lists, tables, links, and images
• Bing Search: results, knowledge sidebar, and related searches
• Datadog dashboards: filters, groups, widget values, top lists, named series, sparklines, and summary statistics
• Datadog notebooks: metadata, narrative, visualization cells, named series, sparklines, and summary statistics
• Amazon: product title, price, rating, features, specifications, and reviews
• LinkedIn: profiles, posts, articles, reactions, and comments
• X: posts, replies, timelines, and engagement statistics
• Polymarket: market odds, volume, resolution rules, and comments
• WhatsApp Web: chat messages with sender and timestamp
• News sites: article body, author, date, and paywall state
• Grokipedia: article content and source metadata

OTHER WEBSITES

A general extractor handles other pages by using the current selection or detecting the main article content.

FEATURES

• Full-page and selection-aware extraction
• YAML frontmatter with title, URL, source, and date metadata
• Inline controls on supported pages and a floating fallback button
• One-click clipboard output
• No ads, analytics, or developer-operated data service

PRIVACY

Processing occurs in your browser. The add-on does not send page content, generated Markdown, or usage analytics to the developer. Some supported authenticated pages are read through that site's own HTTPS endpoints using your existing browser session. Data is processed in memory and written only to your clipboard.

Source code:
https://github.com/bvolpato/copy-as-markdown
```
