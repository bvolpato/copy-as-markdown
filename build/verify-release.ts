#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonObject = Record<string, unknown>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const REQUIRED_EXTENSION_FILES = [
  'manifest.json',
  'content.js',
  'background.js',
  'icons/icon.svg',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
] as const;
const REQUIRED_PNG_DIMENSIONS = new Map([
  ['icons/icon-16.png', 16],
  ['icons/icon-48.png', 48],
  ['icons/icon-128.png', 128],
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message: string): never {
  throw new Error(message);
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function addString(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string') paths.add(value);
}

function addStrings(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) addString(item, paths);
  }
}

function addObjectValues(value: unknown, paths: Set<string>): void {
  const object = asObject(value);
  if (!object) return;
  for (const item of Object.values(object)) addString(item, paths);
}

function collectManifestAssets(manifest: JsonObject): string[] {
  const assets = new Set<string>();
  addObjectValues(manifest.icons, assets);

  const background = asObject(manifest.background);
  if (background) {
    addString(background.service_worker, assets);
    addStrings(background.scripts, assets);
  }

  for (const actionName of ['action', 'browser_action', 'page_action'] as const) {
    const action = asObject(manifest[actionName]);
    if (!action) continue;
    addObjectValues(action.default_icon, assets);
    addString(action.default_popup, assets);
  }

  if (Array.isArray(manifest.content_scripts)) {
    for (const entry of manifest.content_scripts) {
      const contentScript = asObject(entry);
      if (!contentScript) continue;
      addStrings(contentScript.js, assets);
      addStrings(contentScript.css, assets);
    }
  }

  addString(manifest.options_page, assets);
  addString(asObject(manifest.options_ui)?.page, assets);
  addString(manifest.devtools_page, assets);
  addObjectValues(manifest.chrome_url_overrides, assets);
  addString(asObject(manifest.side_panel)?.default_path, assets);
  addStrings(asObject(manifest.sandbox)?.pages, assets);

  const theme = asObject(manifest.theme);
  if (theme) addObjectValues(theme.images, assets);

  if (Array.isArray(manifest.theme_icons)) {
    for (const entry of manifest.theme_icons) {
      const themeIcon = asObject(entry);
      if (!themeIcon) continue;
      addString(themeIcon.light, assets);
      addString(themeIcon.dark, assets);
    }
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const entry of manifest.web_accessible_resources) {
      if (typeof entry === 'string') {
        assets.add(entry);
      } else {
        addStrings(asObject(entry)?.resources, assets);
      }
    }
  }

  if (typeof manifest.default_locale === 'string') {
    assets.add(`_locales/${manifest.default_locale}/messages.json`);
  }

  return [...assets].sort();
}

function normalizeAssetPath(asset: string, context: string): string {
  if (
    asset.length === 0
    || asset.startsWith('/')
    || asset.includes('\\')
    || asset.includes('*')
    || /^[a-z][a-z\d+.-]*:/i.test(asset)
  ) {
    fail(`${context}: unsupported or unsafe manifest asset path "${asset}"`);
  }

  const normalized = path.posix.normalize(asset);
  if (normalized === '..' || normalized.startsWith('../')) {
    fail(`${context}: manifest asset escapes package root: "${asset}"`);
  }
  return normalized;
}

function readJson(buffer: Buffer | string, context: string): JsonObject {
  try {
    const parsed = JSON.parse(buffer.toString());
    return asObject(parsed) ?? fail(`${context}: expected JSON object`);
  } catch (error) {
    fail(`${context}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertVersion(actual: unknown, expected: string, context: string): void {
  if (actual !== expected) {
    fail(`${context}: version ${JSON.stringify(actual)} does not match ${expected}`);
  }
}

function assertDirectoryFile(root: string, relativePath: string, context: string): void {
  const file = path.join(root, relativePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    fail(`${context}: missing ${relativePath}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    fail(`${context}: ${relativePath} must be a non-empty file`);
  }
}

function verifyPng(buffer: Buffer, expectedSize: number | undefined, context: string): void {
  if (
    buffer.length < 24
    || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    fail(`${context}: invalid PNG signature or IHDR`);
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) fail(`${context}: invalid PNG dimensions ${width}x${height}`);
  if (expectedSize !== undefined && (width !== expectedSize || height !== expectedSize)) {
    fail(`${context}: expected ${expectedSize}x${expectedSize} PNG, found ${width}x${height}`);
  }
}

function verifyDirectory(target: string, expectedVersion: string): void {
  const root = path.join(DIST, target);
  const context = `dist/${target}`;
  for (const file of REQUIRED_EXTENSION_FILES) {
    assertDirectoryFile(root, file, context);
  }

  const manifest = readJson(fs.readFileSync(path.join(root, 'manifest.json')), `${context}/manifest.json`);
  assertVersion(manifest.version, expectedVersion, `${context}/manifest.json`);
  for (const asset of collectManifestAssets(manifest)) {
    const normalized = normalizeAssetPath(asset, context);
    assertDirectoryFile(root, normalized, context);
    if (normalized.endsWith('.png')) {
      verifyPng(
        fs.readFileSync(path.join(root, normalized)),
        REQUIRED_PNG_DIMENSIONS.get(normalized),
        `${context}/${normalized}`,
      );
    }
  }
  for (const [icon, size] of REQUIRED_PNG_DIMENSIONS) {
    verifyPng(fs.readFileSync(path.join(root, icon)), size, `${context}/${icon}`);
  }
}

function unzip(zipPath: string, args: string[], context: string): Buffer {
  const result = spawnSync('unzip', [...args, zipPath], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    fail(`${context}: could not run unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim();
    fail(`${context}: unzip failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout;
}

function readZipEntry(zipPath: string, entry: string, context: string): Buffer {
  const result = spawnSync('unzip', ['-p', zipPath, entry], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    fail(`${context}: could not run unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim();
    fail(`${context}: could not read ${entry}${stderr ? `: ${stderr}` : ''}`);
  }
  if (result.stdout.length === 0) {
    fail(`${context}: ${entry} must be a non-empty file`);
  }
  return result.stdout;
}

function verifyZip(target: string, expectedVersion: string): void {
  const zipPath = path.join(DIST, `copy-as-markdown-${target}.zip`);
  const context = path.relative(ROOT, zipPath);
  assertDirectoryFile(DIST, path.basename(zipPath), 'dist');
  unzip(zipPath, ['-tqq'], context);

  const entries = unzip(zipPath, ['-Z1'], context)
    .toString()
    .split(/\r?\n/)
    .filter(Boolean);
  const files = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeAssetPath(entry.replace(/\/$/, ''), context);
    if (entry.endsWith('/')) continue;
    if (files.has(normalized)) fail(`${context}: duplicate archive entry ${normalized}`);
    files.add(normalized);
  }

  for (const file of REQUIRED_EXTENSION_FILES) {
    if (!files.has(file)) fail(`${context}: missing ${file}`);
    const contents = readZipEntry(zipPath, file, context);
    const expectedPngSize = REQUIRED_PNG_DIMENSIONS.get(file);
    if (expectedPngSize !== undefined) {
      verifyPng(contents, expectedPngSize, `${context}/${file}`);
    }
  }

  const manifest = readJson(readZipEntry(zipPath, 'manifest.json', context), `${context}/manifest.json`);
  assertVersion(manifest.version, expectedVersion, `${context}/manifest.json`);
  for (const asset of collectManifestAssets(manifest)) {
    const normalized = normalizeAssetPath(asset, context);
    if (!files.has(normalized)) fail(`${context}: missing manifest asset ${normalized}`);
    const contents = readZipEntry(zipPath, normalized, context);
    if (normalized.endsWith('.png')) {
      verifyPng(contents, REQUIRED_PNG_DIMENSIONS.get(normalized), `${context}/${normalized}`);
    }
  }
}

function sha256(file: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function verifyReleaseBundle(bundleArgument: string, expectedVersion: string): void {
  const bundle = path.resolve(ROOT, bundleArgument);
  const versionedUserscript = `copy-as-markdown-v${expectedVersion}.user.js`;
  const stableUserscript = 'copy-as-markdown.user.js';
  const userscriptMetadata = 'copy-as-markdown.meta.js';
  const expectedArtifacts = [
    versionedUserscript,
    stableUserscript,
    userscriptMetadata,
    `copy-as-markdown-chrome-v${expectedVersion}.zip`,
    `copy-as-markdown-firefox-v${expectedVersion}.zip`,
  ];
  const expectedFiles = new Set([...expectedArtifacts, 'SHA256SUMS']);
  const actualFiles = fs.readdirSync(bundle).sort();

  if (
    actualFiles.length !== expectedFiles.size
    || actualFiles.some((file) => !expectedFiles.has(file))
  ) {
    fail(
      `${bundleArgument}: expected only ${[...expectedFiles].sort().join(', ')}, found ${actualFiles.join(', ')}`,
    );
  }
  for (const artifact of expectedArtifacts) {
    assertDirectoryFile(bundle, artifact, bundleArgument);
  }

  const versionedContents = fs.readFileSync(path.join(bundle, versionedUserscript), 'utf8');
  const stableContents = fs.readFileSync(path.join(bundle, stableUserscript), 'utf8');
  if (stableContents !== versionedContents) {
    fail(`${bundleArgument}: ${stableUserscript} differs from ${versionedUserscript}`);
  }
  const metadataContents = fs.readFileSync(path.join(bundle, userscriptMetadata), 'utf8');
  if (!versionedContents.startsWith(`${metadataContents}\n`)) {
    fail(`${bundleArgument}: ${userscriptMetadata} differs from ${versionedUserscript} metadata`);
  }

  const checksumLines = fs.readFileSync(path.join(bundle, 'SHA256SUMS'), 'utf8')
    .trim()
    .split(/\r?\n/);
  const expectedChecksums = expectedArtifacts.map(
    (artifact) => `${sha256(path.join(bundle, artifact))}  ${artifact}`,
  );
  if (
    checksumLines.length !== expectedChecksums.length
    || checksumLines.some((line, index) => line !== expectedChecksums[index])
  ) {
    fail(`${bundleArgument}/SHA256SUMS: contents do not match release artifacts`);
  }
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === '--') arguments_.shift();
  const expectedArgument = arguments_.shift();
  let bundleArgument: string | undefined;
  if (arguments_[0] === '--bundle' && arguments_[1]) {
    arguments_.shift();
    bundleArgument = arguments_.shift();
  }
  if (arguments_.length > 0) {
    fail('usage: pnpm verify:release -- [expected-version] [--bundle directory]');
  }

  const packageJson = readJson(fs.readFileSync(path.join(ROOT, 'package.json')), 'package.json');
  const packageVersion = packageJson.version;
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    fail('package.json: version must be a non-empty string');
  }
  if (expectedArgument) assertVersion(packageVersion, expectedArgument, 'package.json');

  const userscriptPath = path.join(DIST, 'userscript', 'copy-as-markdown.user.js');
  const userscriptMetadataPath = path.join(DIST, 'userscript', 'copy-as-markdown.meta.js');
  assertDirectoryFile(path.dirname(userscriptPath), path.basename(userscriptPath), 'dist/userscript');
  assertDirectoryFile(
    path.dirname(userscriptMetadataPath),
    path.basename(userscriptMetadataPath),
    'dist/userscript',
  );
  const userscript = fs.readFileSync(userscriptPath, 'utf8');
  const userscriptMetadata = fs.readFileSync(userscriptMetadataPath, 'utf8');
  if (!userscript.startsWith(`${userscriptMetadata}\n`)) {
    fail('dist/userscript/copy-as-markdown.meta.js: metadata differs from userscript');
  }
  const versionMetadata = [...userscript.matchAll(/^\/\/\s+@version\s+(\S+)\s*$/gm)];
  if (versionMetadata.length !== 1) {
    fail(`dist/userscript/copy-as-markdown.user.js: expected one @version field, found ${versionMetadata.length}`);
  }
  assertVersion(versionMetadata[0][1], packageVersion, 'dist/userscript/copy-as-markdown.user.js');
  const expectedDownloadUrl = `https://github.com/bvolpato/copy-as-markdown/releases/download/v${packageVersion}/copy-as-markdown-v${packageVersion}.user.js`;
  if (!userscriptMetadata.includes(`// @downloadURL  ${expectedDownloadUrl}\n`)) {
    fail('dist/userscript/copy-as-markdown.meta.js: versioned @downloadURL is missing');
  }
  if (!userscriptMetadata.includes('// @updateURL    https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.meta.js\n')) {
    fail('dist/userscript/copy-as-markdown.meta.js: stable metadata @updateURL is missing');
  }

  for (const target of ['chrome', 'firefox']) {
    verifyDirectory(target, packageVersion);
    verifyZip(target, packageVersion);
  }
  if (bundleArgument) verifyReleaseBundle(bundleArgument, packageVersion);

  console.log(`✅ Release artifacts verified for v${packageVersion}`);
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
