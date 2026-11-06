import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  browserOpenCommands,
  browserPage,
  completeInteractiveOptions,
  copyExtension,
  parseOptions,
  startUserscriptServer,
  storeUrl,
  validateResolvedOptions,
} from '../build/install.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(REPO_ROOT, 'build/install.mjs');
const sampleUserscript = '// ==UserScript==\n// @name Test\n// @downloadURL https://example.com/latest.js\n// @updateURL https://example.com/latest.meta.js\n// ==/UserScript==\nconsole.log("test");\n';

test('CLI parsing validates options and infers local extension from --copy-to', () => {
  assert.deepEqual(
    (({ type, browser, local, store, copyTo, port }) => ({ type, browser, local, store, copyTo, port }))(
      parseOptions(['--type', 'EXTENSION', '--browser', 'BrAvE', '--copy-to', 'build/copy', '--port', '65535']),
    ),
    { type: 'extension', browser: 'brave', local: true, store: false, copyTo: 'build/copy', port: 65535 },
  );
  assert.throws(() => parseOptions(['--type', 'unknown']), /Invalid --type/);
  assert.throws(() => parseOptions(['--browser', 'safari']), /Invalid --browser/);
  assert.throws(() => parseOptions(['--port', '65536']), /0 to 65535/);
  assert.throws(() => parseOptions(['--port', '1.5']), /0 to 65535/);
  assert.throws(() => parseOptions(['--local', '--store']), /cannot be used together/);
  assert.throws(() => parseOptions(['--type', 'userscript', '--copy-to', 'out']), /apply only to extensions/);
});

test('non-interactive missing choices name the required flags', async () => {
  await assert.rejects(
    completeInteractiveOptions(parseOptions(['--type', 'extension']), {
      input: { isTTY: false },
      output: { isTTY: false },
    }),
    /Missing --browser chrome\|chromium\|brave\|edge\|firefox/,
  );
  await assert.rejects(
    completeInteractiveOptions(parseOptions([]), {
      input: { isTTY: false },
      output: { isTTY: false },
    }),
    /Missing --type extension\|userscript and --browser/,
  );
});

test('extension-only flags remain invalid if an interactive choice selects userscript', () => {
  const options = parseOptions(['--local']);
  options.type = 'userscript';
  options.browser = 'chrome';
  assert.throws(() => validateResolvedOptions(options), /apply only to extensions/);
});

test('browser pages, official stores, and launch candidates map by browser', () => {
  assert.equal(browserPage('chrome'), 'chrome://extensions');
  assert.equal(browserPage('chromium'), 'chrome://extensions');
  assert.equal(browserPage('brave'), 'brave://extensions');
  assert.equal(browserPage('edge'), 'edge://extensions');
  assert.equal(browserPage('firefox'), 'about:debugging#/runtime/this-firefox');
  assert.match(storeUrl('chrome'), /^https:\/\/chromewebstore\.google\.com\//);
  assert.match(storeUrl('brave'), /^https:\/\/chromewebstore\.google\.com\//);
  assert.match(storeUrl('firefox'), /^https:\/\/addons\.mozilla\.org\//);
  assert.deepEqual(browserOpenCommands('firefox', 'linux')[0], ['firefox', []]);
  assert.ok(browserOpenCommands('firefox', 'linux').some(([command]) => command === 'firefox-esr'));
  assert.ok(browserOpenCommands('brave', 'linux').some(([command]) => command === 'brave-browser-stable'));
  assert.ok(browserOpenCommands('chrome', 'linux').every(([command]) => !command.includes('chromium')));
  assert.deepEqual(browserOpenCommands('chrome', 'darwin'), [['open', ['-a', 'Google Chrome']]]);
  assert.deepEqual(browserOpenCommands('chrome', 'win32'), []);
});

test('userscript server serves only the installer page and script over loopback', async (context) => {
  const urls = await startUserscriptServer(sampleUserscript, 0);
  context.after(() => urls.close());

  const pageResponse = await fetch(urls.pageUrl);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html; charset=utf-8$/);
  assert.equal(pageResponse.headers.get('cache-control'), 'no-store');
  const page = await pageResponse.text();
  assert.match(page, /Allow User Scripts/);
  assert.match(page, /Developer Mode/);
  assert.match(page, /https:\/\/www\.tampermonkey\.net\/faq\.php\?q=Q209/);
  const installLink = page.match(/<a href="(http:\/\/127\.0\.0\.1:\d+\/copy-as-markdown\.user\.js)">Install Copy as Markdown userscript<\/a>/)?.[1];
  assert.ok(installLink, 'landing page should link directly to the userscript');

  const scriptResponse = await fetch(installLink);
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get('content-type'), /^text\/javascript; charset=utf-8$/);
  assert.equal(scriptResponse.headers.get('cache-control'), 'no-store');
  assert.equal(await scriptResponse.text(), sampleUserscript);

  const headResponse = await fetch(urls.scriptUrl, { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), '');

  const missingResponse = await fetch(new URL('/package.json', urls.pageUrl));
  assert.equal(missingResponse.status, 404);
  const methodResponse = await fetch(urls.pageUrl, { method: 'POST' });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'GET, HEAD');
  assert.equal(urls.pageUrl.startsWith('http://127.0.0.1:'), true);
});

test('copy refuses an existing target and copies an absent target', async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-as-markdown-install-'));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'manifest.json'), '{"name":"test"}');
  await assert.rejects(copyExtension(source, path.join(source, 'nested')), /must be outside/);
  const existing = path.join(temp, 'existing');
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, 'keep.txt'), 'keep');
  await assert.rejects(copyExtension(source, existing), /Destination already exists/);
  assert.equal(await fs.readFile(path.join(existing, 'keep.txt'), 'utf8'), 'keep');

  const destination = path.join(temp, 'new', 'extension');
  assert.equal(await copyExtension(source, destination), destination);
  assert.equal(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'), '{"name":"test"}');
});

test('store mode resolves from the checkout and prints the store URL when Chrome is unavailable', () => {
  const result = spawnSync(process.execPath, [INSTALLER, '--type', 'extension', '--browser', 'chrome'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Could not open a browser automatically/);
  assert.match(result.stdout, /https:\/\/chromewebstore\.google\.com\/detail\/copy-as-markdown\//);
  assert.doesNotMatch(result.stdout, /Building the browser extension/);
});

test('install.sh reports missing non-interactive browser selection', async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-as-markdown-cli-'));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const result = spawnSync(path.join(REPO_ROOT, 'install.sh'), ['--type', 'extension'], {
    cwd: temp,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--browser chrome\|chromium\|brave\|edge\|firefox/);
});

test('install.sh runs through a symlinked checkout', async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-as-markdown-symlink-'));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const checkout = path.join(temp, 'checkout');
  await fs.symlink(REPO_ROOT, checkout, 'dir');

  const result = spawnSync(path.join(checkout, 'install.sh'), ['--help'], {
    cwd: temp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: \.\/install\.sh/);
});

test('importing the installer from stdin does not start the CLI', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: os.tmpdir(),
    input: `await import(${JSON.stringify(pathToFileURL(INSTALLER).href)});`,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('userscript CLI closes pending connections on SIGINT and SIGTERM', async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-as-markdown-server-cli-'));
  const helper = path.join(temp, 'build', 'install.mjs');
  const userscript = path.join(temp, 'dist', 'userscript', 'copy-as-markdown.user.js');
  await fs.mkdir(path.dirname(helper), { recursive: true });
  await fs.mkdir(path.dirname(userscript), { recursive: true });
  await fs.copyFile(INSTALLER, helper);
  await fs.writeFile(userscript, sampleUserscript);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(process.execPath, [helper, '--type', 'userscript', '--browser', 'firefox', '--skip-build', '--no-open', '--port', '0'], {
      cwd: temp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { errorOutput += chunk; });
    let socket;
    context.after(async () => {
      socket?.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(() => resolve(), 2500);
      });
      await fs.rm(temp, { recursive: true, force: true });
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for installer output. ${output} ${errorOutput}`)), 10_000);
      child.stdout.on('data', () => {
        if (output.includes('Userscript file: http://127.0.0.1:')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Installer exited early with code ${code}. ${errorOutput}`));
      });
    });

    const port = Number(output.match(/Userscript file: http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]);
    assert.ok(port > 0, output);
    socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('GET / HTTP/1.1\r\nHost:');
    await new Promise((resolve) => setTimeout(resolve, 25));

    child.kill(signal);
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Installer did not stop after ${signal}. ${errorOutput}`)), 2500);
      child.once('exit', (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    assert.equal(code, 0, errorOutput);
    assert.match(output, /Userscript install page: http:\/\/127\.0\.0\.1:/);
    assert.match(output, /Open this URL in firefox:/);
    socket.destroy();
  }
});
