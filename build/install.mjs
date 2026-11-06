#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_NAME = 'copy-as-markdown.user.js';
const STORE_URLS = Object.freeze({
  chrome: 'https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/',
});
const MANAGER_URLS = Object.freeze({
  tampermonkey: 'https://www.tampermonkey.net/',
  violentmonkey: 'https://violentmonkey.github.io/get-it/',
});
const BROWSERS = Object.freeze(['chrome', 'chromium', 'brave', 'edge', 'firefox']);
const TYPES = Object.freeze(['extension', 'userscript']);

function usage() {
  return `Usage: ./install.sh [options]

Choose an extension or userscript and a browser. With no arguments, the
installer asks interactive questions when run in a terminal.

Options:
  -t, --type extension|userscript   Install type
  -b, --browser NAME                chrome, chromium, brave, edge, or firefox
      --local                        Install a local extension build
      --store                        Open the official extension store (default)
      --copy-to NEW_DIR              Copy a local extension build to NEW_DIR
      --skip-build                   Use existing dist/ build artifacts
      --port PORT                    Userscript server port (0 chooses a free port)
      --no-open                      Print the URL without opening a browser
  -h, --help                         Show this help

Examples:
  ./install.sh
  ./install.sh --type extension --browser chrome
  ./install.sh --type extension --browser firefox --local
  ./install.sh --type userscript --browser brave --port 8765
  ./install.sh --browser chrome --copy-to "$HOME/.local/share/copy-as-markdown"`;
}

function parseOptions(args) {
  const options = {
    type: undefined,
    browser: undefined,
    local: false,
    store: false,
    copyTo: undefined,
    skipBuild: false,
    noOpen: false,
    port: 0,
    help: false,
    hadArguments: args.length > 0,
  };
  const seen = new Set();
  const valueFlags = new Map([
    ['--type', 'type'], ['-t', 'type'],
    ['--browser', 'browser'], ['-b', 'browser'],
    ['--copy-to', 'copyTo'], ['--port', 'port'],
  ]);
  const booleanFlags = new Map([
    ['--local', 'local'], ['--store', 'store'], ['--skip-build', 'skipBuild'],
    ['--no-open', 'noOpen'], ['--help', 'help'], ['-h', 'help'],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equalsAt = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);

    if (valueFlags.has(flag)) {
      const key = valueFlags.get(flag);
      if (seen.has(key)) throw new Error(`Option ${flag} was provided more than once.`);
      seen.add(key);
      const value = inlineValue ?? args[index + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`Option ${flag} requires a value.`);
      if (inlineValue === undefined) index += 1;
      options[key] = value;
      continue;
    }
    if (booleanFlags.has(flag)) {
      if (inlineValue !== undefined) throw new Error(`Option ${flag} does not take a value.`);
      const key = booleanFlags.get(flag);
      if (seen.has(key)) throw new Error(`Option ${flag} was provided more than once.`);
      seen.add(key);
      options[key] = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.type !== undefined) {
    options.type = String(options.type).toLowerCase();
    if (!TYPES.includes(options.type)) throw new Error(`Invalid --type: ${options.type}. Choose extension or userscript.`);
  }
  if (options.browser !== undefined) {
    options.browser = String(options.browser).toLowerCase();
    if (!BROWSERS.includes(options.browser)) {
      throw new Error(`Invalid --browser: ${options.browser}. Choose chrome, chromium, brave, edge, or firefox.`);
    }
  }
  if (options.port !== undefined) {
    if (!/^\d+$/.test(String(options.port))) throw new Error(`Invalid --port: ${options.port}. Choose a number from 0 to 65535.`);
    options.port = Number(options.port);
    if (!Number.isSafeInteger(options.port) || options.port > 65535) {
      throw new Error(`Invalid --port: ${options.port}. Choose a number from 0 to 65535.`);
    }
  }
  if (options.local && options.store) throw new Error('--local and --store cannot be used together.');
  if (options.copyTo !== undefined) {
    if (options.store) throw new Error('--copy-to implies --local and cannot be used with --store.');
    options.local = true;
    options.type ??= 'extension';
  }
  if (options.type === 'userscript' && (options.local || options.store || options.copyTo !== undefined)) {
    throw new Error('--local, --store, and --copy-to apply only to extensions.');
  }
  return options;
}

function browserPage(browser) {
  if (browser === 'firefox') return 'about:debugging#/runtime/this-firefox';
  if (browser === 'brave') return 'brave://extensions';
  if (browser === 'edge') return 'edge://extensions';
  return 'chrome://extensions';
}

function storeUrl(browser) {
  return browser === 'firefox' ? STORE_URLS.firefox : STORE_URLS.chrome;
}

function browserOpenCommands(browser, platform = process.platform) {
  if (platform === 'darwin') {
    const apps = {
      chrome: 'Google Chrome', chromium: 'Chromium', brave: 'Brave Browser',
      edge: 'Microsoft Edge', firefox: 'Firefox',
    };
    return [['open', ['-a', apps[browser]]]];
  }
  if (platform !== 'linux') return [];
  const candidates = {
    chrome: ['google-chrome', 'google-chrome-stable'],
    chromium: ['chromium', 'chromium-browser'],
    brave: ['brave-browser', 'brave-browser-stable', 'brave'],
    edge: ['microsoft-edge', 'microsoft-edge-stable'],
    firefox: ['firefox', 'firefox-esr'],
  };
  return (candidates[browser] ?? []).map((command) => [command, []]);
}

async function openBrowser(browser, url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const commands = browserOpenCommands(browser, platform);
  for (const [command, prefixArgs] of commands) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawnProcess(command, [...prefixArgs, url], { detached: true, stdio: 'ignore' });
        let settled = false;
        let timeout;
        const succeed = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          child.unref();
          resolve();
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        };
        child.once('error', fail);
        child.once('spawn', () => {
          child.unref();
          timeout = setTimeout(succeed, 750);
        });
        child.once('exit', (code, signal) => {
          if (code === 0) succeed();
          else fail(new Error(`${command} exited with ${code ?? signal}.`));
        });
      });
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function validateResolvedOptions(options) {
  if (!TYPES.includes(options.type)) throw new Error('Choose --type extension or --type userscript.');
  if (!BROWSERS.includes(options.browser)) {
    throw new Error('Choose --browser chrome, chromium, brave, edge, or firefox.');
  }
  if (options.type === 'userscript' && (options.local || options.store || options.copyTo !== undefined)) {
    throw new Error('--local, --store, and --copy-to apply only to extensions.');
  }
}

async function askChoice(rl, label, choices) {
  const listing = choices.map((choice, index) => `  ${index + 1}) ${choice.label}`).join('\n');
  while (true) {
    const answer = (await rl.question(`${label}\n${listing}\nChoose a number or name: `)).trim().toLowerCase();
    const byIndex = Number(answer) - 1;
    if (Number.isInteger(byIndex) && byIndex >= 0 && byIndex < choices.length) return choices[byIndex].value;
    const matched = choices.find((choice) => choice.value.toLowerCase() === answer);
    if (matched) return matched.value;
    console.log('Please choose one of the listed options.');
  }
}

async function completeInteractiveOptions(options, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    const missing = [];
    if (!options.type) missing.push('--type extension|userscript');
    if (!options.browser) missing.push('--browser chrome|chromium|brave|edge|firefox');
    if (missing.length) throw new Error(`Missing ${missing.join(' and ')}. Supply them when running without a terminal.`);
    return options;
  }

  const rl = createInterface({ input, output });
  const choicesWereMissing = !options.type || !options.browser;
  try {
    if (!options.type) {
      options.type = await askChoice(rl, 'What would you like to install?', [
        { value: 'extension', label: 'Browser extension' },
        { value: 'userscript', label: 'Userscript' },
      ]);
    }
    if (!options.browser) {
      options.browser = await askChoice(rl, 'Which browser will you use?', BROWSERS.map((value) => ({ value, label: value })));
    }
    if (options.type === 'extension' && !options.local && !options.store) {
      if (options.hadArguments && !choicesWereMissing) {
        options.store = true;
        return options;
      }
      const source = await askChoice(rl, 'How should the extension be installed?', [
        { value: 'store', label: 'Official browser store' },
        { value: 'local', label: 'Build and load this local checkout' },
      ]);
      options.store = source === 'store';
      options.local = source === 'local';
    }
    return options;
  } finally {
    rl.close();
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} was not found. Install it and try again.`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
}

async function buildProject() {
  try {
    const stats = await fs.stat(path.join(ROOT, 'node_modules'));
    if (!stats.isDirectory()) throw new Error('node_modules is not a directory');
  } catch {
    console.log('Installing project dependencies with pnpm...');
    runCommand('pnpm', ['install', '--frozen-lockfile'], {
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' },
    });
  }
  console.log('Building the browser extension...');
  runCommand('pnpm', ['build']);
}

async function requireFile(filePath, description) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`${description} is missing: ${filePath}`);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${description} is missing: ${filePath}`);
    throw error;
  }
}

async function copyExtension(sourceDirectory, destination) {
  const target = path.resolve(ROOT, destination);
  const relativeTarget = path.relative(path.resolve(sourceDirectory), target);
  if (relativeTarget === '' || (!relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== '..' && !path.isAbsolute(relativeTarget))) {
    throw new Error(`Copy destination must be outside the built extension directory: ${target}`);
  }
  try {
    await fs.lstat(target);
    throw new Error(`Destination already exists. Choose a new path: ${target}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(sourceDirectory, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  return target;
}

async function extensionDirectory(browser, copyTo) {
  const sourceDirectory = path.join(ROOT, browser === 'firefox' ? 'dist/firefox' : 'dist/chrome');
  await requireFile(path.join(sourceDirectory, 'manifest.json'), 'Built extension manifest');
  if (copyTo === undefined) return sourceDirectory;
  return copyExtension(sourceDirectory, copyTo);
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function validateUserscript(script) {
  if (!script.startsWith('// ==UserScript==')) throw new Error('Built userscript is missing its metadata header.');
  if (!script.includes('// ==/UserScript==')) throw new Error('Built userscript metadata header is incomplete.');
}

function renderInstallPage(scriptUrl) {
  const scriptLink = escapeHtml(scriptUrl);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install Copy as Markdown</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#172033}a{color:#315be8}li{margin:.7rem 0}code{overflow-wrap:anywhere}</style>
<h1>Install Copy as Markdown</h1>
<p>Install a userscript manager first, then use the install link below. Your manager will ask you to confirm before adding the script.</p>
<ul>
  <li><a href="${MANAGER_URLS.tampermonkey}">Install Tampermonkey</a></li>
  <li><a href="${MANAGER_URLS.violentmonkey}">Install Violentmonkey</a></li>
</ul>
<p><a href="${scriptLink}">Install Copy as Markdown userscript</a></p>
<p>If the link displays or downloads JavaScript instead, open your manager dashboard and import this script URL:</p>
<p><code>${scriptLink}</code></p>
<p>With Tampermonkey 5.3 or newer in Chrome-based browsers, enable either the “Allow User Scripts” setting or Developer Mode before running scripts. <a href="https://www.tampermonkey.net/faq.php?q=Q209">See Tampermonkey's instructions</a>.</p>
<p>After installation, the userscript manager will use the project's GitHub release metadata for future updates.</p>
</html>`;
}

async function startUserscriptServer(script, port = 0) {
  validateUserscript(script);
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      response.writeHead(400, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    let content;
    let contentType;
    if (pathname === '/') {
      const address = server.address();
      const scriptUrl = `http://127.0.0.1:${address.port}/${SCRIPT_NAME}`;
      content = renderInstallPage(scriptUrl);
      contentType = 'text/html; charset=utf-8';
    } else if (pathname === `/${SCRIPT_NAME}`) {
      content = script;
      contentType = 'text/javascript; charset=utf-8';
    } else {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    const body = Buffer.from(content);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    pageUrl: `${origin}/`,
    scriptUrl: `${origin}/${SCRIPT_NAME}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function printBrowserResult(opened, url) {
  if (!opened) console.log(`Could not open a browser automatically. Open this URL manually: ${url}`);
  else console.log(`Opened ${url}`);
}

async function offerUrl(browser, url, noOpen) {
  if (noOpen) {
    console.log(`Open this URL in ${browser}: ${url}`);
    return;
  }
  try {
    printBrowserResult(await openBrowser(browser, url), url);
  } catch (error) {
    console.log(`Could not open a browser automatically (${error.message}). Open this URL manually: ${url}`);
  }
}

async function installStore(browser, noOpen) {
  const url = storeUrl(browser);
  console.log(`Install Copy as Markdown from the official ${browser === 'firefox' ? 'Firefox Add-ons' : 'Chrome Web Store'}.`);
  console.log(`Follow the store prompts to add it to ${browser}.`);
  await offerUrl(browser, url, noOpen);
}

async function installLocalExtension(browser, options) {
  if (!options.skipBuild) await buildProject();
  const directory = await extensionDirectory(browser, options.copyTo);
  const url = browserPage(browser);
  console.log(`Local extension files: ${directory}`);
  if (browser === 'firefox') {
    console.log(`In Firefox, open ${url}, choose “Load Temporary Add-on…”, then select ${path.join(directory, 'manifest.json')}.`);
    console.log('Firefox removes temporary add-ons when it restarts.');
  } else {
    console.log(`In ${browser}, open ${url}, turn on Developer mode, choose “Load unpacked”, then select the extension directory above.`);
  }
  await offerUrl(browser, url, options.noOpen);
}

async function readBuiltUserscript(skipBuild) {
  if (!skipBuild) await buildProject();
  const filePath = path.join(ROOT, 'dist/userscript', SCRIPT_NAME);
  await requireFile(filePath, 'Built userscript');
  const script = await fs.readFile(filePath, 'utf8');
  validateUserscript(script);
  return script;
}

async function waitForServerStop(server) {
  await new Promise((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      server.closeAllConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function installUserscript(browser, options) {
  const script = await readBuiltUserscript(options.skipBuild);
  let urls;
  try {
    urls = await startUserscriptServer(script, options.port);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new Error(`Port ${options.port} is already in use. Choose another with --port.`);
    throw error;
  }
  const stopped = waitForServerStop(urls.server);
  console.log(`Userscript install page: ${urls.pageUrl}`);
  console.log(`Userscript file: ${urls.scriptUrl}`);
  console.log('The local server is available only on this computer and stays open until you press Ctrl+C.');
  try {
    await offerUrl(browser, urls.pageUrl, options.noOpen);
    await stopped;
  } finally {
    if (urls.server.listening) await urls.close();
  }
}

async function main(args = process.argv.slice(2)) {
  let options = parseOptions(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  options = await completeInteractiveOptions(options);
  validateResolvedOptions(options);
  if (options.type === 'extension') {
    if (options.local) await installLocalExtension(options.browser, options);
    else await installStore(options.browser, options.noOpen);
    return;
  }
  await installUserscript(options.browser, options);
}

export {
  BROWSERS,
  ROOT,
  browserOpenCommands,
  browserPage,
  completeInteractiveOptions,
  copyExtension,
  extensionDirectory,
  main,
  parseOptions,
  renderInstallPage,
  startUserscriptServer,
  storeUrl,
  validateResolvedOptions,
  validateUserscript,
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Installer error: ${error.message}`);
    process.exitCode = 1;
  });
}
