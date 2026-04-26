#!/usr/bin/env tsx

/**
 * Build script for Copy as Markdown.
 *
 * Uses esbuild to bundle the TypeScript source into a single IIFE, then
 * wraps it into three distribution targets:
 *   1. Tampermonkey / Violentmonkey userscript
 *   2. Chrome extension (Manifest V3)
 *   3. Firefox extension (Manifest V2)
 *
 * Usage:
 *   npx tsx build/build.ts
 */

import { buildSync, type BuildResult } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const pkg = require('../package.json');
const VERSION = pkg.version;

// ---------- Types ----------

interface ManifestBase {
  name: string;
  version: string;
  description: string;
  permissions: string[];
  icons: Record<string, string>;
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at: string;
  }>;
}

interface ChromeManifest extends ManifestBase {
  manifest_version: 3;
  action: { default_icon: Record<string, string>; default_title: string };
  background: { service_worker: string };
}

interface FirefoxManifest extends ManifestBase {
  manifest_version: 2;
  browser_action: { default_icon: Record<string, string>; default_title: string };
  browser_specific_settings: { gecko: { id: string; strict_min_version: string } };
  background: { scripts: string[] };
}

// ---------- esbuild: TypeScript → single IIFE bundle ----------

function bundle(): string {
  const result: BuildResult = buildSync({
    entryPoints: [path.join(SRC, 'main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: false,       // keep readable for userscript installs
    sourcemap: false,
    logLevel: 'warning',
  });
  return result.outputFiles![0].text;
}

function bundleBackground(): string {
  const result: BuildResult = buildSync({
    entryPoints: [path.join(SRC, 'background.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: true,
    sourcemap: false,
    logLevel: 'warning',
  });
  return result.outputFiles![0].text;
}

// ---------- Collect @match patterns from TS source ----------

function collectMatchPatterns(): string[] {
  const patterns = new Set<string>();
  const extractorDir = path.join(SRC, 'extractors');
  const files = fs.readdirSync(extractorDir).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(extractorDir, file), 'utf-8');
    const matchBlock = content.match(/matches:\s*\[([\s\S]*?)\]/);
    if (matchBlock) {
      const items = matchBlock[1].match(/'([^']+)'/g);
      if (items) items.forEach((item) => patterns.add(item.replace(/'/g, '')));
    }
  }
  return [...patterns];
}

function getExtractorCount(): number {
  return fs.readdirSync(path.join(SRC, 'extractors')).filter((f) => f.endsWith('.ts')).length;
}

// ---------- Userscript ----------

function buildUserscript(code: string): string {
  const header = `// ==UserScript==
// @name         Copy as Markdown
// @namespace    https://github.com/bvolpato/copy-as-markdown
// @version      ${VERSION}
// @description  Context-aware "Copy as Markdown" button for sharing web pages with LLMs
// @author       Bruno Volpato
// @license      MIT
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        none
// @icon         ${'data:image/svg+xml;base64,' + Buffer.from(getSVGIcon()).toString('base64')}
// @homepageURL  https://github.com/bvolpato/copy-as-markdown
// @supportURL   https://github.com/bvolpato/copy-as-markdown/issues
// @downloadURL  https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js
// @updateURL    https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js
// ==/UserScript==
`;

  return header + '\n' + code;
}

// ---------- Chrome Extension (MV3) ----------

function buildChromeManifest(patterns: string[]): ChromeManifest {
  return {
    manifest_version: 3,
    name: 'Copy as Markdown',
    version: VERSION,
    description: 'Context-aware "Copy as Markdown" button — the fastest way to share web content with LLMs like ChatGPT, Claude, and Gemini.',
    permissions: ['activeTab', 'clipboardWrite'],
    icons: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle' }],
    action: { default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png' }, default_title: 'Copy as Markdown' },
  };
}

// ---------- Firefox Extension (MV2) ----------

function buildFirefoxManifest(patterns: string[]): FirefoxManifest {
  return {
    manifest_version: 2,
    name: 'Copy as Markdown',
    version: VERSION,
    description: 'Context-aware "Copy as Markdown" button — the fastest way to share web content with LLMs like ChatGPT, Claude, and Gemini.',
    permissions: ['activeTab', 'clipboardWrite'],
    icons: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
    background: { scripts: ['background.js'] },
    content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle' }],
    browser_action: { default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png' }, default_title: 'Copy as Markdown' },
    browser_specific_settings: { gecko: { id: 'copy-as-markdown@bvolpato', strict_min_version: '57.0' } },
  };
}

// ---------- SVG Icon ----------

function getSVGIcon(): string {
  return fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf-8');
}

function generatePngs(svgPath: string, outDir: string): void {
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const outPath = path.join(outDir, `icon-${size}.png`);
    try {
      // Try ImageMagick v7 (magick) first, then v6 (convert)
      try {
        execSync(`magick -background none "${svgPath}" -resize ${size}x${size} "${outPath}"`, { stdio: 'ignore' });
      } catch {
        execSync(`convert -background none "${svgPath}" -resize ${size}x${size} "${outPath}"`, { stdio: 'ignore' });
      }
    } catch (e) {
      console.warn(`⚠️ Failed to generate ${outPath}. Make sure ImageMagick is installed.`);
    }
  }
}

// ---------- Main ----------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function main(): void {
  console.log('🔨 Building Copy as Markdown...\n');

  // Clean dist
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });

  // Bundle TypeScript → single JS
  console.log('  📦 Bundling TypeScript with esbuild...');
  const code = bundle();
  const patterns = collectMatchPatterns();

  // 1. Userscript
  const usDir = path.join(DIST, 'userscript');
  ensureDir(usDir);
  const userscript = buildUserscript(code);
  fs.writeFileSync(path.join(usDir, 'copy-as-markdown.user.js'), userscript);
  console.log(`  ✅ Userscript → dist/userscript/copy-as-markdown.user.js (${(userscript.length / 1024).toFixed(1)} KB)`);

  // 2. Chrome Extension
  const chromeDir = path.join(DIST, 'chrome');
  ensureDir(path.join(chromeDir, 'icons'));
  fs.writeFileSync(path.join(chromeDir, 'manifest.json'), JSON.stringify(buildChromeManifest(patterns), null, 2));
  fs.writeFileSync(path.join(chromeDir, 'content.js'), code);
  fs.writeFileSync(path.join(chromeDir, 'background.js'), bundleBackground());
  fs.writeFileSync(path.join(chromeDir, 'icons', 'icon.svg'), getSVGIcon());
  generatePngs(path.join(chromeDir, 'icons', 'icon.svg'), path.join(chromeDir, 'icons'));
  console.log('  ✅ Chrome Extension → dist/chrome/ (Manifest V3)');

  // 3. Firefox Extension
  const firefoxDir = path.join(DIST, 'firefox');
  ensureDir(path.join(firefoxDir, 'icons'));
  fs.writeFileSync(path.join(firefoxDir, 'manifest.json'), JSON.stringify(buildFirefoxManifest(patterns), null, 2));
  fs.writeFileSync(path.join(firefoxDir, 'content.js'), code);
  fs.writeFileSync(path.join(firefoxDir, 'background.js'), bundleBackground());
  fs.writeFileSync(path.join(firefoxDir, 'icons', 'icon.svg'), getSVGIcon());
  generatePngs(path.join(firefoxDir, 'icons', 'icon.svg'), path.join(firefoxDir, 'icons'));
  console.log('  ✅ Firefox Extension → dist/firefox/ (Manifest V2)');

  // Summary
  const extractorCount = getExtractorCount();
  console.log(`\n📊 Summary:`);
  console.log(`   ${extractorCount} extractors`);
  console.log(`   ${patterns.length} URL match patterns`);
  console.log(`   3 output targets (userscript, chrome, firefox)`);
  console.log('\n✨ Build complete!');
}

main();
