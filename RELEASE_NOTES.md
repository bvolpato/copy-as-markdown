# Extension Release Notes

Store listing copy and policy details live in [STORE_LISTING.md](STORE_LISTING.md).

## Current release

- Extension version: `1.3.2`
- GitHub release: https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.3.2
- Chrome package: `copy-as-markdown-chrome-v1.3.2.zip`
- Firefox package: `copy-as-markdown-firefox-v1.3.2.zip`
- Checksums: `SHA256SUMS` attached to GitHub release

Version `1.3.2` includes all extension changes from `1.3.1`, website favicon styling, and safer release tooling without the vulnerable `extract-zip` dependency.

Store status checked 2026-08-12: [Chrome](https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/) still publish `1.2.2`. Upload `1.3.2` to both stores.

## Version notes

Paste this into Firefox version notes and any Chrome update or reviewer-notes field that requests a user-facing change summary:

```text
Version 1.3.2 expands structured Markdown extraction and improves extension behavior.

- Adds W&B run metadata, configuration, sampled metric histories, summaries, and sparklines.
- Adds MLflow run and comparison extraction with bounded metric-history tables.
- Adds Sphinx, Read the Docs, and custom-domain documentation detection.
- Expands first-class support across search, social, commerce, media, developer, and productivity sites.
- Improves LinkedIn profiles, posts, and articles; Google Docs; Jira; Confluence; DuckDuckGo; and Notion.
- Adds draggable, persistent page controls; better inline placement; print-safe UI; bounded Markdown output; and safer metadata escaping.

All processing remains local. Authenticated integrations call only the current service's HTTPS APIs using the existing browser session. No remote code, analytics, or developer-operated data service is used.
```

## Chrome reviewer notes

```text
Version 1.3.2 adds page controls on declared Datadog dashboard and notebook routes and on W&B run routes. Extraction starts only after the user clicks Copy as Markdown. Same-site HTTPS API calls use the user's existing browser session; results are processed in memory and copied only to the clipboard.

The extension contains no remote executable code, analytics, ads, account system, or developer-operated data service. activeTab, scripting, and clipboardWrite are used for the user-triggered copy action. Host-specific content scripts are limited to the routes declared in manifest.json.

Test the toolbar action on any public page. W&B and Datadog integration tests require the reviewer's own authenticated account and accessible run, dashboard, or notebook.
```

## Firefox reviewer notes

```text
The submitted ZIP contains bundled JavaScript generated from TypeScript with esbuild, so source code is provided separately.

Build environment:
- Linux
- Node.js 22
- pnpm 10

Build commands:
pnpm install --frozen-lockfile
pnpm package:all
pnpm verify:release -- 1.3.2

The Firefox artifact is dist/copy-as-markdown-firefox.zip. The build uses only dependencies locked in pnpm-lock.yaml and does not download or execute remote code at runtime.
```

## Store update steps

### 1. Download and verify packages

Download both extension ZIPs and `SHA256SUMS` from the [v1.3.2 release](https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.3.2). Verify them before upload:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### 2. Update Chrome Web Store

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and select Copy as Markdown.
2. Open **Package**, choose **Upload new package**, and upload `copy-as-markdown-chrome-v1.3.2.zip`.
3. Review **Store listing**, **Privacy practices**, and **Distribution** against [STORE_LISTING.md](STORE_LISTING.md). Keep existing screenshots unless their UI is stale.
4. Paste Chrome reviewer notes above where requested.
5. Submit for review. Existing published version stays live during review. Choose deferred publishing only if manual rollout control is wanted.

Official instructions: https://developer.chrome.com/docs/webstore/update

### 3. Update Firefox Add-ons

1. Open [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/addons), select Copy as Markdown, and choose **Upload New Version**.
2. Upload `copy-as-markdown-firefox-v1.3.2.zip` and select Firefox as platform.
3. When asked whether source code is needed to build the extension, choose **Yes**.
4. Upload the tagged source archive: https://github.com/bvolpato/copy-as-markdown/archive/refs/tags/v1.3.2.zip
5. Paste version notes and Firefox reviewer notes above, then submit for review.

Official instructions:

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/publish/source-code-submission/

### 4. Verify publication

After approval:

1. Confirm both store listings show version `1.3.2`.
2. Install each store build in a clean browser profile.
3. Smoke-test toolbar copy on a public article, selection-only copy, one supported inline-control page, and one authenticated Datadog or W&B page if accessible.
4. Confirm output includes YAML frontmatter, structured Markdown body, and no injected Copy as Markdown controls.

## Cutting a later extension patch

Only cut another patch after extension source changes:

1. Update `package.json` to next version.
2. Run `pnpm typecheck && pnpm test:regression && pnpm package:all && pnpm verify:release -- <version>`.
3. Merge version change into `main`.
4. Create and push signed tag matching package version:

   ```bash
   version="$(node -p "require('./package.json').version")"
   git tag -s "v$version" -m "v$version"
   git push origin "v$version"
   ```

5. Wait for release workflow to publish verified packages. Do not upload locally built packages to GitHub Releases.
