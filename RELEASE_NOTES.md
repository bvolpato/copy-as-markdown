# Extension Release Notes

Store listing copy and policy details live in [STORE_LISTING.md](STORE_LISTING.md).

## Current release

- Extension version: `1.6.0`
- GitHub release: https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.6.0
- Chrome package: `copy-as-markdown-chrome-v1.6.0.zip`
- Firefox package: `copy-as-markdown-firefox-v1.6.0.zip`
- Checksums: `SHA256SUMS` attached to GitHub release

Version `1.6.0` adds 22 new site and platform extractors (bringing total coverage to 97 extractors across Discourse, MediaWiki, OpenAPI/Swagger/Redoc/Scalar docs, Ghost and Obsidian Publish, Gitea/Forgejo/Codeberg, Grafana, Sentry, Outlook Web, crates.io, pkg.go.dev, RubyGems, Docker Hub, OpenReview, PubMed, Semantic Scholar, Google Scholar, Mastodon, Bluesky, Lobsters, SEC EDGAR, Kalshi, and IMDb) and expands documentation detection to Docusaurus, MkDocs Material, VitePress, Astro Starlight, mdBook, Nextra, Fumadocs, and Fern. It hardens all 75 existing extractors, adds an `Alt+Shift+M` keyboard shortcut, enables selection-first copying across supported sites, improves the generic Readability-style fallback with Schema.org JSON-LD metadata, and optimizes extractor routing, DOM observation, lazy image resolution, and minified extension bundles.

Validation covers typechecking, unit and matcher tests, browser regression checks, package verification, and sanitized captured fixtures across supported sites. Authenticated services such as Grafana, Sentry, Outlook, Datadog, and W&B use the existing browser session and require an authenticated account for manual end-to-end verification.

Store submission and approval are separate from the GitHub release. Confirm version `1.6.0` on [Chrome](https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/) after review.

## Version notes

Paste this into Firefox version notes and any Chrome update or reviewer-notes field that requests a user-facing change summary:

```text
Version 1.6.0 adds 22 new site and platform extractors (97 total), including Discourse, MediaWiki, OpenAPI docs, Ghost/Obsidian Publish, Gitea/Forgejo/Codeberg, Grafana, Sentry, Outlook Web, crates.io, pkg.go.dev, RubyGems, Docker Hub, PubMed, OpenReview, Semantic Scholar, Google Scholar, Mastodon, Bluesky, Lobsters, SEC EDGAR, Kalshi, and IMDb, plus 8 additional documentation frameworks. It also hardens all 75 existing extractors, adds the Alt+Shift+M shortcut, supports selection-first copy on supported sites, improves the generic fallback extractor, and speeds up routing, observers, and extension bundles.

All processing remains local. Authenticated integrations call only the current service's HTTPS APIs using the existing browser session. No remote code, analytics, or developer-operated data service is used.
```

## Chrome reviewer notes

```text
Version 1.6.0 adds 22 new site and platform extractors, expands documentation framework detection, hardens all existing extractors, adds the Alt+Shift+M keyboard shortcut command, enables selection-first copy on supported sites, and optimizes routing, DOM observation, and bundle size. Extraction starts only after the user clicks Copy as Markdown or invokes the keyboard shortcut. Same-site HTTPS API calls use the user's existing browser session. Results are processed in memory and copied only to the clipboard.

The extension contains no remote executable code, analytics, ads, account system, or developer-operated data service. activeTab, scripting, and clipboardWrite are used for the user-triggered copy action. Automatic page buttons remain limited to Datadog dashboards, Datadog notebooks, and W&B runs. Host permissions are unchanged.

Test the toolbar action or Alt+Shift+M shortcut on any public page. W&B and Datadog integration tests require the reviewer's own authenticated account and accessible run, dashboard, or notebook.
```

## Firefox reviewer notes

```text
The submitted ZIP contains bundled JavaScript generated from TypeScript with esbuild, so source code is provided separately.

Build environment:
- Linux
- Node.js 22.22.2 or newer
- pnpm 11.22.0

Build commands:
pnpm install --frozen-lockfile
pnpm package:all
pnpm verify:release -- 1.6.0

The Firefox artifact is dist/copy-as-markdown-firefox.zip. Submit the source archive from the signed v1.6.0 tag. The build uses only dependencies locked in pnpm-lock.yaml and does not download or execute remote code at runtime.
```

## Store update steps

### 1. Download and verify packages

Download both extension ZIPs and `SHA256SUMS` from the [v1.6.0 release](https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.6.0). Verify them before upload:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### 2. Update Chrome Web Store

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and select Copy as Markdown.
2. Open **Package**, choose **Upload new package**, and upload `copy-as-markdown-chrome-v1.6.0.zip`.
3. Review **Store listing**, **Privacy practices**, and **Distribution** against [STORE_LISTING.md](STORE_LISTING.md). Keep existing screenshots unless their UI is stale.
4. Paste Chrome reviewer notes above where requested.
5. Submit for review. Existing published version stays live during review. Choose deferred publishing only if manual rollout control is wanted.

Official instructions: https://developer.chrome.com/docs/webstore/update

### 3. Update Firefox Add-ons

1. Open [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/addons), select Copy as Markdown, and choose **Upload New Version**.
2. Upload `copy-as-markdown-firefox-v1.6.0.zip` and select Firefox as platform.
3. When asked whether source code is needed to build the extension, choose **Yes**.
4. Upload the tagged source archive: https://github.com/bvolpato/copy-as-markdown/archive/refs/tags/v1.6.0.zip
5. Paste version notes and Firefox reviewer notes above, then submit for review.

Official instructions:

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/publish/source-code-submission/

### 4. Verify publication

After approval:

1. Confirm both store listings show version `1.6.0`.
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
