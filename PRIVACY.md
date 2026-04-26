# Privacy Policy — Copy as Markdown

**Last updated:** April 26, 2026

## Overview

Copy as Markdown is a browser extension and userscript that converts web page content to Markdown format and copies it to your clipboard. It is designed with privacy as a core principle.

## Data Collection

**Copy as Markdown collects zero user data.**

- No personal information is collected
- No browsing history is recorded
- No analytics or tracking is used
- No data is sent to any server
- No cookies are set
- No accounts are required

## How It Works

When you click the "Copy as Markdown" button:

1. The extension reads the current page's DOM content (text, headings, tables, links, code) **locally in your browser**
2. It converts the content to Markdown format **locally in your browser**
3. It writes the Markdown text to your **local clipboard**

That's it. No data ever leaves your browser.

## Permissions

| Permission | Why It's Needed |
| --- | --- |
| `activeTab` | Read the current page's DOM to extract content when you click the button |
| `clipboardWrite` | Write the generated Markdown to your clipboard |
| `<all_urls>` (content script) | Inject the floating button on every website so it works universally |

## Third-Party Services

Copy as Markdown does not integrate with any third-party services, APIs, or analytics platforms.

## Open Source

The full source code is available at [github.com/bvolpato/copy-as-markdown](https://github.com/bvolpato/copy-as-markdown) under the MIT License. You can verify everything stated in this policy by reading the code.

## Changes

If this privacy policy changes, the update will be posted here with a new "Last updated" date.

## Contact

For questions about this privacy policy, open an issue at [github.com/bvolpato/copy-as-markdown/issues](https://github.com/bvolpato/copy-as-markdown/issues).
