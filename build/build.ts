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
}

interface FirefoxManifest extends ManifestBase {
  manifest_version: 2;
  browser_action: { default_icon: Record<string, string>; default_title: string };
  browser_specific_settings: { gecko: { id: string; strict_min_version: string } };
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
  const patterns = collectMatchPatterns();
  const matchLines = patterns.map((p) => `// @match        ${p}`).join('\n');

  const header = `// ==UserScript==
// @name         Copy as Markdown
// @namespace    https://github.com/bvolpato/copy-as-markdown
// @version      ${VERSION}
// @description  Context-aware "Copy as Markdown" button for sharing web pages with LLMs
// @author       Bruno Volpato
// @license      MIT
${matchLines}
// @grant        GM_setClipboard
// @grant        none
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236366f1'/%3E%3Ctext x='50' y='68' font-size='52' font-weight='bold' text-anchor='middle' fill='white'%3EMd%3C/text%3E%3C/svg%3E
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
    content_scripts: [{ matches: patterns, js: ['content.js'], run_at: 'document_idle' }],
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
    content_scripts: [{ matches: patterns, js: ['content.js'], run_at: 'document_idle' }],
    browser_action: { default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png' }, default_title: 'Copy as Markdown' },
    browser_specific_settings: { gecko: { id: 'copy-as-markdown@bvolpato', strict_min_version: '57.0' } },
  };
}

// ---------- SVG Icon ----------

function generateSVGIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
    <linearGradient id="foldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#e2e8f0" stop-opacity="0.9"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="2" dy="4" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
    <filter id="foldShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="-2" dy="2" stdDeviation="2" flood-opacity="0.2"/>
    </filter>
  </defs>
  
  <!-- App Icon Base -->
  <rect x="8" y="8" width="112" height="112" rx="28" fill="url(#bg)" filter="url(#shadow)"/>
  
  <!-- Markdown file body -->
  <path d="M 36 32 C 32 32 28 36 28 40 L 28 88 C 28 92 32 96 36 96 L 92 96 C 96 96 100 92 100 88 L 100 60 L 72 32 Z" fill="#ffffff" opacity="0.95"/>
  
  <!-- Document Fold -->
  <path d="M 100 60 L 76 60 C 73.79 60 72 58.21 72 56 L 72 32 Z" fill="url(#foldGradient)" filter="url(#foldShadow)"/>
  
  <!-- "M" (Markdown mark) -->
  <path d="M 38 80 L 38 56 L 46 56 L 52 68 L 58 56 L 66 56 L 66 80 L 59 80 L 59 65 L 54 75 L 50 75 L 45 65 L 45 80 Z" fill="#1e293b"/>
  
  <!-- Down arrow (Markdown mark) -->
  <path d="M 74 80 L 74 65 L 68 65 L 78 55 L 88 65 L 82 65 L 82 80 Z" fill="#1e293b"/>
</svg>`;
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
  fs.writeFileSync(path.join(chromeDir, 'icons', 'icon.svg'), generateSVGIcon());
  generatePngs(path.join(chromeDir, 'icons', 'icon.svg'), path.join(chromeDir, 'icons'));
  console.log('  ✅ Chrome Extension → dist/chrome/ (Manifest V3)');

  // 3. Firefox Extension
  const firefoxDir = path.join(DIST, 'firefox');
  ensureDir(path.join(firefoxDir, 'icons'));
  fs.writeFileSync(path.join(firefoxDir, 'manifest.json'), JSON.stringify(buildFirefoxManifest(patterns), null, 2));
  fs.writeFileSync(path.join(firefoxDir, 'content.js'), code);
  fs.writeFileSync(path.join(firefoxDir, 'icons', 'icon.svg'), generateSVGIcon());
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
