# Library guide

`@bvolpato/copy-as-markdown` is a browser-safe ESM package. It contains the same site extractors and the same Markdown converter as the extension.

The library loads only the extractor chunks that you request. It does not inject buttons, write to the clipboard, use extension APIs, or store state.

```bash
pnpm add @bvolpato/copy-as-markdown
```

## Convert HTML or DOM

Use these functions for HTML or DOM that you own. They do not run a site extractor.

```typescript
import { domToMarkdown, htmlToMarkdown } from '@bvolpato/copy-as-markdown';

const fromHtml = htmlToMarkdown('<article><h1>Hello</h1></article>');
const fromElement = domToMarkdown(document.querySelector('main')!);
const fromDocument = domToMarkdown(new DOMParser().parseFromString(html, 'text/html'));
```

## Extract the current page

Site extractors run in the active page, because some of them read same-origin APIs and the current browser state.

### Choose extractors at run time

```typescript
import { createExtractorMatcher, loadExtractors } from '@bvolpato/copy-as-markdown';

const extractors = await loadExtractors(['jira', 'confluence', 'github', 'google-docs']);
const matcher = createExtractorMatcher({ extractors });

const match = matcher.match({ url: window.location.href, document });
if (match) {
  const markdown = await match.extract();
  await navigator.clipboard.writeText(markdown);
}
```

### Choose extractors at build time

Fixed subpath imports let a bundler include only the extractors that you use. This content script supports four sites. `domains` narrows the built-in URL patterns, and `when` adds a rule that your extension owns.

```typescript
import { createExtractorMatcher } from '@bvolpato/copy-as-markdown/core';
import { confluenceExtractor } from '@bvolpato/copy-as-markdown/extractors/confluence';
import { githubExtractor } from '@bvolpato/copy-as-markdown/extractors/github';
import { googleDocsExtractor } from '@bvolpato/copy-as-markdown/extractors/google-docs';
import { jiraExtractor } from '@bvolpato/copy-as-markdown/extractors/jira';

const matcher = createExtractorMatcher({
  extractors: [jiraExtractor, confluenceExtractor, githubExtractor, googleDocsExtractor],
  domains: ['github.com', 'docs.google.com', 'acme.atlassian.net', 'jira.example.com'],
  when: ({ document, extractor }) => {
    if (extractor.name !== 'GitHub') return true;
    return Boolean(document?.querySelector('[data-my-extension-context]'));
  },
});
```

See `exports` in [package.json](package.json) for the extractors that have a subpath. All other extractors load through `loadExtractor(id)`.

A plain script without a bundler can load `dist/library/browser.js`, which sets the global `CopyAsMarkdown`.

### Restrict a matcher

| Option | Meaning |
| --- | --- |
| `extractors` | Loaded extractors, or names of loaded extractors |
| `domains` | Exact hostnames. Use `*.atlassian.net` only if every subdomain is eligible |
| `origins` | Exact origins, with scheme and optional port |
| `urlPatterns` | Userscript-style patterns or regular expressions |
| `when` | A function that receives the parsed URL, the document, and the matched extractor |

## Write your own extractor

A custom extractor can use URL patterns, a DOM check, or both.

```typescript
import { defineExtractor, domToMarkdown } from '@bvolpato/copy-as-markdown/core';

const internalApp = defineExtractor({
  name: 'Internal app',
  matches: [],
  detect: (document) => Boolean(document?.querySelector('[data-internal-app]')),
  extract: async () => domToMarkdown(document.querySelector('main')!),
});
```

## API

| Function | Purpose |
| --- | --- |
| `getAvailableExtractorIds()` | List the <!-- count -->97<!-- /count --> extractor IDs |
| `loadExtractor(id)` | Load one extractor |
| `loadExtractors(ids)` | Load several extractors in parallel |
| `loadAllExtractors()` | Load every extractor |
| `getExtractors()` | List the extractors that are loaded in this module instance |
| `createExtractorMatcher(options)` | Match a URL or a document against extractors |
| `defineExtractor(config)` | Create a custom extractor |
| `domToMarkdown(root)` | Convert a document or an element |
| `elementToMarkdown(element)` | Convert an element |
| `htmlToMarkdown(html)` | Convert an HTML string |
