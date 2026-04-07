#!/usr/bin/env node

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
 *   node build/build.js
 */

import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// ---------- esbuild: TypeScript → single IIFE bundle ----------

function bundle() {
  const result = buildSync({
    entryPoints: [path.join(SRC, 'main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: false,       // keep readable for userscript installs
    sourcemap: false,
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

// ---------- Collect @match patterns from TS source ----------

function collectMatchPatterns() {
  const patterns = new Set();
  const extractorDir = path.join(SRC, 'extractors');
  const files = fs.readdirSync(extractorDir).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(extractorDir, file), 'utf-8');
    const matchBlock = content.match(/matches:\s*\[([\s\S]*?)\]/);
    if (matchBlock) {
      const items = matchBlock[1].match(/'([^']+)'/g);
      if (items) items.forEach(item => patterns.add(item.replace(/'/g, '')));
    }
  }
  return [...patterns];
}

function getExtractorCount() {
  return fs.readdirSync(path.join(SRC, 'extractors')).filter(f => f.endsWith('.ts')).length;
}

// ---------- Userscript ----------

function buildUserscript(code) {
  const patterns = collectMatchPatterns();
  const matchLines = patterns.map(p => `// @match        ${p}`).join('\n');

  const header = `// ==UserScript==
// @name         Copy as Markdown
// @namespace    https://github.com/bvolpato/copy-as-markdown
// @version      1.0.0
// @description  Context-aware "Copy as Markdown" button for sharing web pages with LLMs
// @author       Bruno Volpato
// @license      MIT
${matchLines}
// @grant        GM_setClipboard
// @grant        none
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236366f1'/%3E%3Ctext x='50' y='68' font-size='52' font-weight='bold' text-anchor='middle' fill='white'%3EMd%3C/text%3E%3C/svg%3E
// @homepageURL  https://github.com/bvolpato/copy-as-markdown
// @supportURL   https://github.com/bvolpato/copy-as-markdown/issues
// @downloadURL  https://raw.githubusercontent.com/bvolpato/copy-as-markdown/main/dist/userscript/copy-as-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/bvolpato/copy-as-markdown/main/dist/userscript/copy-as-markdown.user.js
// ==/UserScript==
`;

  return header + '\n' + code;
}

// ---------- Chrome Extension (MV3) ----------

function buildChromeManifest(patterns) {
  return {
    manifest_version: 3,
    name: 'Copy as Markdown',
    version: '1.0.0',
    description: 'Context-aware "Copy as Markdown" button — the fastest way to share web content with LLMs like ChatGPT, Claude, and Gemini.',
    permissions: ['activeTab', 'clipboardWrite'],
    icons: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
    content_scripts: [{ matches: patterns, js: ['content.js'], run_at: 'document_idle' }],
    action: { default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png' }, default_title: 'Copy as Markdown' },
  };
}

// ---------- Firefox Extension (MV2) ----------

function buildFirefoxManifest(patterns) {
  return {
    manifest_version: 2,
    name: 'Copy as Markdown',
    version: '1.0.0',
    description: 'Context-aware "Copy as Markdown" button — the fastest way to share web content with LLMs like ChatGPT, Claude, and Gemini.',
    permissions: ['activeTab', 'clipboardWrite'],
    icons: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
    content_scripts: [{ matches: patterns, js: ['content.js'], run_at: 'document_idle' }],
    browser_action: { default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png' }, default_title: 'Copy as Markdown' },
    browser_specific_settings: { gecko: { id: 'copy-as-markdown@bvolpato', strict_min_version: '57.0' } },
  };
}

// ---------- SVG Icon ----------

function generateSVGIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="50%" style="stop-color:#8b5cf6"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#bg)"/>
  <rect x="30" y="24" width="68" height="84" rx="8" fill="rgba(255,255,255,0.15)"/>
  <rect x="44" y="16" width="40" height="14" rx="7" fill="rgba(255,255,255,0.25)"/>
  <text x="64" y="82" font-size="40" font-weight="800" text-anchor="middle" fill="white" font-family="-apple-system,BlinkMacSystemFont,sans-serif" letter-spacing="-1">Md</text>
</svg>`;
}

// ---------- Main ----------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
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
  console.log('  ✅ Chrome Extension → dist/chrome/ (Manifest V3)');

  // 3. Firefox Extension
  const firefoxDir = path.join(DIST, 'firefox');
  ensureDir(path.join(firefoxDir, 'icons'));
  fs.writeFileSync(path.join(firefoxDir, 'manifest.json'), JSON.stringify(buildFirefoxManifest(patterns), null, 2));
  fs.writeFileSync(path.join(firefoxDir, 'content.js'), code);
  fs.writeFileSync(path.join(firefoxDir, 'icons', 'icon.svg'), generateSVGIcon());
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
