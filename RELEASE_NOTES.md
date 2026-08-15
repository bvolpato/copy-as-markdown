# Extension Release Notes

Store listing copy and policy details live in [STORE_LISTING.md](STORE_LISTING.md).

## Current release

- Extension version: `1.3.3`
- GitHub release: https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.3.3
- Chrome package: `copy-as-markdown-chrome-v1.3.3.zip`
- Firefox package: `copy-as-markdown-firefox-v1.3.3.zip`
- Checksums: `SHA256SUMS` attached to GitHub release

Version `1.3.3` adds OpenRouter, Artificial Analysis, and DeepSWE extraction; captures ChatGPT canvas writing blocks; removes output truncation; normalizes hidden Unicode watermark channels; and adds sanitized public-site regression fixtures.

Store status checked 2026-08-15: [Chrome](https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/) still publish `1.2.2`. Upload `1.3.3` to both stores.

## Version notes

Paste this into Firefox version notes and any Chrome update or reviewer-notes field that requests a user-facing change summary:

```text
Version 1.3.3 expands structured Markdown extraction and preserves complete output.

- Adds full model, provider, pricing, benchmark, and FAQ extraction for OpenRouter.
- Adds model and published leaderboard extraction for Artificial Analysis.
- Adds DeepSWE benchmark, configuration, efficiency, task, and methodology extraction.
- Captures ChatGPT canvas writing blocks and complete long conversations without character or turn caps.
- Normalizes non-ASCII spaces, smart punctuation, compatibility forms, and common invisible watermark channels.
- Adds privacy-preserving public-site fixtures and improves MDN extraction placement and coverage.

All processing remains local. Authenticated integrations call only the current service's HTTPS APIs using the existing browser session. No remote code, analytics, or developer-operated data service is used.
```

## Chrome reviewer notes

```text
Version 1.3.3 adds OpenRouter, Artificial Analysis, and DeepSWE extraction; ChatGPT canvas support; complete unbounded clipboard output; and Unicode sanitation. Extraction starts only after the user clicks Copy as Markdown. Same-site HTTPS API calls use the user's existing browser session; results are processed in memory and copied only to the clipboard.

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
pnpm verify:release -- 1.3.3

The Firefox artifact is dist/copy-as-markdown-firefox.zip. The build uses only dependencies locked in pnpm-lock.yaml and does not download or execute remote code at runtime.
```

## Store update steps

### 1. Download and verify packages

Download both extension ZIPs and `SHA256SUMS` from the [v1.3.3 release](https://github.com/bvolpato/copy-as-markdown/releases/tag/v1.3.3). Verify them before upload:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### 2. Update Chrome Web Store

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and select Copy as Markdown.
2. Open **Package**, choose **Upload new package**, and upload `copy-as-markdown-chrome-v1.3.3.zip`.
3. Review **Store listing**, **Privacy practices**, and **Distribution** against [STORE_LISTING.md](STORE_LISTING.md). Keep existing screenshots unless their UI is stale.
4. Paste Chrome reviewer notes above where requested.
5. Submit for review. Existing published version stays live during review. Choose deferred publishing only if manual rollout control is wanted.

Official instructions: https://developer.chrome.com/docs/webstore/update

### 3. Update Firefox Add-ons

1. Open [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/addons), select Copy as Markdown, and choose **Upload New Version**.
2. Upload `copy-as-markdown-firefox-v1.3.3.zip` and select Firefox as platform.
3. When asked whether source code is needed to build the extension, choose **Yes**.
4. Upload the tagged source archive: https://github.com/bvolpato/copy-as-markdown/archive/refs/tags/v1.3.3.zip
5. Paste version notes and Firefox reviewer notes above, then submit for review.

Official instructions:

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/publish/source-code-submission/

### 4. Verify publication

After approval:

1. Confirm both store listings show version `1.3.3`.
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
