# Privacy Policy — Copy as Markdown

**Last updated:** July 26, 2026

## Overview

Copy as Markdown is a browser extension and userscript that converts web page content to Markdown format and copies it to your clipboard. It is designed with privacy as a core principle.

## Data Handling

Copy as Markdown handles data only when needed to convert content selected by the user into Markdown. Depending on the page, this can include:

- Content from the current page or selection
- Current page title and URL used as source metadata
- Conversation text when the user chooses to copy a conversation page

This data is processed in memory, written to the user's clipboard, and not retained by the extension. It is not sent to the developer or unrelated third parties. The extension uses no analytics, tracking, advertising, or developer-operated data service. It sets no cookies and requires no extension account.

## How It Works

When you click the "Copy as Markdown" extension icon in your browser toolbar:

1. The extension reads the current page's DOM content (text, headings, tables, links, code) **locally in your browser**
2. It converts the content to Markdown format **locally in your browser**
3. It writes the Markdown text to your **local clipboard**

Some supported pages require a same-site HTTPS request to retrieve content that is not present in the visible DOM. These requests use your existing browser session and go only to the site you are viewing. Responses are processed in memory and are not retained or sent to the developer or unrelated third parties.

On Datadog dashboard and notebook URLs, the extension loads its page button automatically so it can appear in the page toolbar. After you click it, the extension can request dashboard or notebook definitions and metric series from Datadog's same-origin APIs. Conversion and clipboard access still happen in your browser.

## Permissions

| Permission | Why It's Needed |
| --- | --- |
| `activeTab` | Read the current page's DOM to extract content when you click the extension icon in the toolbar |
| `clipboardWrite` | Write the generated Markdown to your clipboard |
| `scripting` | Execute the content extraction script into the active tab on demand |
| Datadog dashboard and notebook site access | Place the Copy as Markdown button in page toolbars and request page data from same-origin Datadog APIs after a click |

## Third-Party Services

Copy as Markdown does not use developer-operated services, analytics, or advertising platforms. Supported extractors may request content from the current site's own HTTPS endpoints using your existing browser session. No content is sent to unrelated third parties.

## Limited Use

Copy as Markdown uses page content, current-page metadata, and conversation text only to provide its user-facing Markdown conversion feature. It does not use this data for advertising, credit decisions, analytics, or any unrelated purpose. The developer cannot access this data, and no human review occurs.

## Open Source

The full source code is available at [github.com/bvolpato/copy-as-markdown](https://github.com/bvolpato/copy-as-markdown) under the MIT License. You can verify everything stated in this policy by reading the code.

## Changes

If this privacy policy changes, the update will be posted here with a new "Last updated" date.

## Contact

For questions about this privacy policy, open an issue at [github.com/bvolpato/copy-as-markdown/issues](https://github.com/bvolpato/copy-as-markdown/issues).
