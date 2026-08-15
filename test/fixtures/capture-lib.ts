import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import {
  type CaptureSource,
  type FixtureCase,
  type FixtureProvenance,
  type FixtureSite,
  type FixtureSource,
  ROOT,
  WORK_DIR,
  fixtureDirectory,
} from './catalog';

export const SANITIZER_VERSION = 2;
const PAGE_TIMEOUT_MS = 45_000;
const FIXTURE_TIMEOUT_MS = 12_000;

interface WaybackCapture {
  timestamp: string;
  original: string;
  digest: string;
}

interface CapturedPage {
  html: string;
  provenance: FixtureProvenance;
  rawScreenshot: string;
}

export interface VerificationResult {
  extractor: string;
  markdown: string;
  placement: 'anchor' | 'floating';
  screenshot: Buffer;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 0)
    || octets[0] >= 224;
}

function mappedIpv4Address(address: string): string | null {
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hexadecimal = address.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('fec')
    || normalized.startsWith('fed')
    || normalized.startsWith('fee')
    || normalized.startsWith('fef')
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:');
}

export async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Only public HTTP(S) URLs can be captured: ${value}`);
  }
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')) {
    throw new Error('Localhost capture is not allowed');
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`URL does not resolve exclusively to public addresses: ${value}`);
  }
  return url;
}

async function isPublicRequest(
  value: string,
  hostChecks: Map<string, Promise<boolean>>,
): Promise<boolean> {
  try {
    const url = new URL(value);
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const key = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    let check = hostChecks.get(key);
    if (!check) {
      check = assertPublicUrl(url.href).then(() => true, () => false);
      hostChecks.set(key, check);
    }
    return await check;
  } catch {
    return false;
  }
}

async function discoverWaybackCapture(originalUrl: string): Promise<WaybackCapture> {
  const query = new URLSearchParams({
    url: originalUrl,
    output: 'json',
    fl: 'timestamp,original,mimetype,statuscode,digest',
    limit: '-10',
    collapse: 'digest',
  });
  query.append('filter', 'statuscode:200');
  query.append('filter', 'mimetype:text/html');

  const response = await fetch(`https://web.archive.org/cdx/search/cdx?${query}`, {
    headers: { 'User-Agent': 'copy-as-markdown-fixture-capture/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Wayback CDX returned HTTP ${response.status}`);
  const rows = await response.json() as string[][];
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(`Wayback has no usable HTML capture for ${originalUrl}`);
  }
  const header = rows[0];
  const timestampIndex = header.indexOf('timestamp');
  const originalIndex = header.indexOf('original');
  const digestIndex = header.indexOf('digest');
  const row = rows.at(-1)!;
  return {
    timestamp: row[timestampIndex],
    original: row[originalIndex],
    digest: row[digestIndex],
  };
}

async function configurePage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument('globalThis.__name = globalThis.__name || ((value) => value);');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setBypassCSP(true);
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  const hostChecks = new Map<string, Promise<boolean>>();
  page.on('request', (request) => {
    void (async () => {
      try {
        const allowed = await isPublicRequest(request.url(), hostChecks);
        if (request.isInterceptResolutionHandled()) return;
        if (allowed) await request.continue();
        else await request.abort('blockedbyclient');
      } catch {
        if (!request.isInterceptResolutionHandled()) {
          await request.abort('blockedbyclient').catch(() => undefined);
        }
      }
    })();
  });
}

async function settlePage(page: Page, readySelector: string): Promise<void> {
  await page.waitForSelector(readySelector, { timeout: PAGE_TIMEOUT_MS });
  await page.waitForNetworkIdle({ idleTime: 750, timeout: 8_000 }).catch(() => undefined);
}

async function injectAndCheckLivePage(page: Page, scriptContent: string, expectedExtractor: string): Promise<void> {
  await page.addScriptTag({ content: scriptContent });
  await page.waitForSelector('#cam-copy-btn', { timeout: FIXTURE_TIMEOUT_MS });
  const extractor = await page.$eval('#cam-copy-btn', (button) =>
    (button as HTMLElement).dataset.camExtractor || '');
  if (extractor !== expectedExtractor) {
    throw new Error(`Live page routed to ${JSON.stringify(extractor)} instead of ${JSON.stringify(expectedExtractor)}`);
  }
}

async function sanitizeRenderedPage(page: Page, excludedSelectors: string[]): Promise<string> {
  return page.evaluate((selectors) => {
    document.querySelectorAll([
      '#wm-ipp', '#wm-ipp-base', '#wm-ipp-print', '#donato',
      '[data-cam-instance]', '#cam-styles', '#cam-toast-styles', '#cam-toast', '#cam-option-dialog',
    ].join(',')).forEach((element) => element.remove());

    for (const element of Array.from(document.querySelectorAll('*'))) {
      const shadow = (element as HTMLElement).shadowRoot;
      if (!shadow) continue;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-fixture-shadow-root', 'open');
      wrapper.append(...Array.from(shadow.childNodes).map((node) => node.cloneNode(true)));
      element.append(wrapper);
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);
      if (element.hidden || element.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') {
        element.remove();
      }
    }

    document.querySelectorAll([
      'script', 'style', 'link', 'base', 'iframe', 'object', 'embed', 'canvas', 'svg',
      'video', 'audio', 'source', 'picture', 'img', 'noscript', 'template', 'form',
    ].join(',')).forEach((element) => element.remove());

    const allowed = new Set([
      'id', 'class', 'role', 'itemprop', 'name', 'type', 'checked', 'selected', 'disabled',
      'open', 'slot', 'colspan', 'rowspan', 'scope', 'datetime', 'href', 'title', 'alt',
      'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-expanded', 'aria-pressed',
      'aria-selected', 'aria-current', 'data-testid', 'data-test-id', 'data-e2e', 'data-uia',
      'data-qa', 'data-a-target', 'data-component-name', 'data-block-id', 'data-post-id',
      'data-turn', 'data-message-author-role', 'data-fixture-shadow-root',
    ]);
    const identifierAttributes = new Set(['id', 'class', 'aria-labelledby', 'aria-describedby']);
    const textAttributes = new Set(['title', 'alt', 'aria-label']);
    let attributeToken = 0;
    let linkToken = 0;

    const sanitizeIdentifier = (value: string) => value.split(/\s+/).filter((token) => {
      if (!token || token.length > 80 || token.includes('@')) return false;
      if (/^[a-f\d]{20,}$/i.test(token) || /^\d{8,}$/.test(token)) return false;
      if (/^[\w+/=-]{32,}$/.test(token) && /\d/.test(token)) return false;
      return true;
    }).join(' ');

    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (!allowed.has(name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (identifierAttributes.has(name)) {
          const sanitized = sanitizeIdentifier(attribute.value);
          if (sanitized) element.setAttribute(name, sanitized);
          else element.removeAttribute(name);
        } else if (textAttributes.has(name)) {
          attributeToken += 1;
          element.setAttribute(name, `FIXTURE_ATTRIBUTE_${String(attributeToken).padStart(4, '0')}`);
        } else if (name === 'datetime') {
          element.setAttribute(name, '2026-01-01T00:00:00Z');
        } else if (name === 'href') {
          linkToken += 1;
          element.setAttribute(name, `https://example.invalid/fixture-link-${String(linkToken).padStart(4, '0')}`);
        }
      }
    }

    const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    const commentsToRemove: Node[] = [];
    while (comments.nextNode()) commentsToRemove.push(comments.currentNode);
    commentsToRemove.forEach((node) => node.parentNode?.removeChild(node));

    const textWalker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (textWalker.nextNode()) textNodes.push(textWalker.currentNode as Text);
    let textToken = 0;
    for (const node of textNodes) {
      if (!node.data.trim()) continue;
      textToken += 1;
      const tag = node.parentElement?.tagName.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TEXT';
      node.data = `FIXTURE_${tag}_${String(textToken).padStart(4, '0')}`;
    }

    selectors.forEach((selector, index) => {
      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) throw new Error(`Excluded selector not found: ${selector}`);
      const marker = `FIXTURE_EXCLUDED_${String(index + 1).padStart(4, '0')}`;
      elements.forEach((element) => element.prepend(document.createTextNode(marker)));
    });

    if (document.querySelectorAll('*').length > 30_000) {
      throw new Error('Sanitized page exceeds 30,000 elements');
    }
    return '<!doctype html>\n' + document.documentElement.outerHTML;
  }, excludedSelectors);
}

async function captureCandidate(
  browser: Browser,
  site: FixtureSite,
  fixtureCase: FixtureCase,
  targetUrl: string,
  source: FixtureSource,
  scriptContent: string,
  workDirectory: string,
): Promise<{ html: string; rawScreenshot: string }> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  fs.mkdirSync(workDirectory, { recursive: true });
  try {
    await configurePage(page);
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    if (!response || response.status() >= 400) {
      throw new Error(`${source} navigation returned HTTP ${response?.status() ?? 'unknown'}`);
    }
    await settlePage(page, fixtureCase.readySelector);
    if (source === 'live') await injectAndCheckLivePage(page, scriptContent, site.extractor);

    const rawScreenshot = path.join(workDirectory, `${source}.png`);
    await page.screenshot({ path: rawScreenshot, fullPage: false });
    const html = await sanitizeRenderedPage(page, fixtureCase.excludedSelectors || []);
    return { html, rawScreenshot };
  } catch (error) {
    const failureScreenshot = path.join(workDirectory, `${source}-failure.png`);
    await page.screenshot({ path: failureScreenshot, fullPage: false }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

export async function capturePublicFixture(
  browser: Browser,
  site: FixtureSite,
  fixtureCase: FixtureCase,
  requestedSource: CaptureSource,
  scriptContent: string,
): Promise<CapturedPage> {
  await assertPublicUrl(fixtureCase.url);
  const workDirectory = path.join(WORK_DIR, site.id, fixtureCase.id);
  let liveError: unknown;

  if (requestedSource !== 'wayback') {
    try {
      const captured = await captureCandidate(
        browser, site, fixtureCase, fixtureCase.url, 'live', scriptContent, workDirectory,
      );
      return {
        ...captured,
        provenance: {
          source: 'live',
          originalUrl: fixtureCase.url,
          capturedAt: new Date().toISOString(),
          sanitizerVersion: SANITIZER_VERSION,
        },
      };
    } catch (error) {
      liveError = error;
      if (requestedSource === 'live' || fixtureCase.wayback === false) throw error;
    }
  }

  try {
    const archive = typeof fixtureCase.wayback === 'object'
      ? {
          timestamp: fixtureCase.wayback.timestamp,
          original: fixtureCase.url,
          digest: fixtureCase.wayback.digest,
        }
      : await discoverWaybackCapture(fixtureCase.url);
    const archiveUrl = `https://web.archive.org/web/${archive.timestamp}/${archive.original}`;
    const captured = await captureCandidate(
      browser, site, fixtureCase, archiveUrl, 'wayback', scriptContent, workDirectory,
    );
    return {
      ...captured,
      provenance: {
        source: 'wayback',
        originalUrl: fixtureCase.url,
        capturedAt: new Date().toISOString(),
        captureTimestamp: archive.timestamp,
        captureDigest: archive.digest,
        sanitizerVersion: SANITIZER_VERSION,
      },
    };
  } catch (archiveError) {
    const liveMessage = liveError instanceof Error ? liveError.message : String(liveError || 'not attempted');
    const archiveMessage = archiveError instanceof Error ? archiveError.message : String(archiveError);
    throw new Error(`Live capture failed: ${liveMessage}. Wayback fallback failed: ${archiveMessage}`);
  }
}

function secretFindings(value: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['authorization header', /\bauthorization\s*[:=]\s*(?:bearer|basic)\b/i],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ];
  return checks.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
}

export function auditSanitizedFixture(html: string, markdown?: string): void {
  const findings = secretFindings(`${html}\n${markdown || ''}`);
  if (findings.length > 0) throw new Error(`Privacy audit found: ${findings.join(', ')}`);
  if (/\s(?:value|src|srcset|style|content)=/i.test(html)) {
    throw new Error('Sanitized HTML contains a forbidden value, source, style, or content attribute');
  }
  if (/<(?:script|style|iframe|object|embed|canvas|svg|img|form)\b/i.test(html)) {
    throw new Error('Sanitized HTML contains an active or media element');
  }
  const textSegments = [...html.matchAll(/>([^<]+)</g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const unsafeText = textSegments.find((text) => !/^FIXTURE_[A-Z0-9_]+$/.test(text));
  if (unsafeText) throw new Error(`Sanitized HTML contains non-synthetic text: ${unsafeText.slice(0, 80)}`);
}

async function openFixturePage(
  browser: Browser,
  html: string,
  url: string,
  scriptContent: string,
): Promise<Page> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('globalThis.__name = globalThis.__name || ((value) => value);');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setBypassCSP(true);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      request.abort('blockedbyclient');
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
  await page.addScriptTag({ content: scriptContent });
  await page.waitForSelector('#cam-copy-btn', { timeout: FIXTURE_TIMEOUT_MS });
  return page;
}

async function captureMarkdown(page: Page, optionId?: string): Promise<string> {
  await page.evaluate(() => {
    (window as any).__camCapturedMarkdown = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as any).__camCapturedMarkdown = text; } },
    });
    document.execCommand = (command) => command === 'copy';
  });
  await page.click('#cam-copy-btn');
  if (optionId) {
    await page.waitForSelector(`#cam-option-dialog [data-option-id="${optionId}"]`, {
      timeout: FIXTURE_TIMEOUT_MS,
    });
    await page.click(`#cam-option-dialog [data-option-id="${optionId}"]`);
  }
  await page.waitForFunction(() => (window as any).__camCapturedMarkdown.length > 0, {
    timeout: FIXTURE_TIMEOUT_MS,
  });
  return page.evaluate(() => (window as any).__camCapturedMarkdown as string);
}

export async function verifyFixtureHtml(
  browser: Browser,
  site: FixtureSite,
  fixtureCase: FixtureCase,
  html: string,
  scriptContent: string,
): Promise<VerificationResult> {
  auditSanitizedFixture(html);
  (fixtureCase.excludedSelectors || []).forEach((_, index) => {
    const marker = `FIXTURE_EXCLUDED_${String(index + 1).padStart(4, '0')}`;
    if (!html.includes(marker)) {
      throw new Error(`${site.id}/${fixtureCase.id} fixture misses exclusion marker ${marker}`);
    }
  });
  const page = await openFixturePage(browser, html, fixtureCase.url, scriptContent);
  try {
    const state = await page.evaluate((anchorSelector, anchorPosition) => {
      const button = document.querySelector<HTMLElement>('#cam-copy-btn');
      const target = anchorSelector ? document.querySelector(anchorSelector) : null;
      const node = button?.closest<HTMLElement>('[data-cam-anchor-wrapper]') || button;
      let anchorCorrect = true;
      if (anchorSelector && anchorPosition) {
        anchorCorrect = !!button && !!target && !!node;
        if (anchorCorrect) {
          switch (anchorPosition) {
            case 'prepend':
              anchorCorrect = node!.parentElement === target && target!.firstElementChild === node;
              break;
            case 'before':
              anchorCorrect = node!.parentElement === target!.parentElement
                && node!.nextElementSibling === target;
              break;
            case 'after':
              anchorCorrect = node!.parentElement === target!.parentElement
                && node!.previousElementSibling === target;
              break;
            case 'overlay':
              anchorCorrect = !!button!.closest('.cam-overlay-container');
              break;
            case 'append':
              anchorCorrect = node!.parentElement === target && target!.lastElementChild === node;
              break;
          }
        }
      }
      return {
        extractor: button?.dataset.camExtractor || '',
        buttons: document.querySelectorAll('#cam-copy-btn').length,
        wrappers: document.querySelectorAll('.cam-floating-wrapper, [data-cam-anchor-wrapper]').length,
        placement: button?.classList.contains('cam-floating') ? 'floating' : 'anchor',
        anchorFound: !anchorSelector || !!target,
        anchorCorrect,
      };
    }, fixtureCase.anchorSelector, fixtureCase.anchorPosition);
    if (state.extractor !== site.extractor) {
      throw new Error(`${site.id}/${fixtureCase.id} routed to ${JSON.stringify(state.extractor)} instead of ${JSON.stringify(site.extractor)}`);
    }
    if (state.buttons !== 1 || state.wrappers > 1
      || (state.placement === 'floating' && state.wrappers !== 1)) {
      throw new Error(`${site.id}/${fixtureCase.id} rendered ${state.buttons} buttons and ${state.wrappers} wrappers`);
    }
    if (state.placement !== fixtureCase.placement) {
      throw new Error(`${site.id}/${fixtureCase.id} used ${state.placement} placement instead of ${fixtureCase.placement}`);
    }
    if (!state.anchorFound || !state.anchorCorrect) {
      throw new Error(`${site.id}/${fixtureCase.id} did not place button at declared anchor`);
    }

    await page.$eval('#cam-copy-btn', (button) => button.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const screenshot = await page.screenshot({ fullPage: false }) as Buffer;
    const markdown = await captureMarkdown(page, fixtureCase.optionId);
    if (markdown.length < fixtureCase.minChars || markdown.length > fixtureCase.maxChars) {
      throw new Error(`${site.id}/${fixtureCase.id} produced ${markdown.length} chars outside ${fixtureCase.minChars}-${fixtureCase.maxChars}`);
    }
    for (const required of fixtureCase.required || []) {
      if (!markdown.includes(required)) {
        throw new Error(`${site.id}/${fixtureCase.id} output misses ${JSON.stringify(required)}`);
      }
    }
    for (const forbidden of fixtureCase.forbidden || []) {
      if (markdown.includes(forbidden)) {
        throw new Error(`${site.id}/${fixtureCase.id} output contains ${JSON.stringify(forbidden)}`);
      }
    }
    if (markdown.includes('FIXTURE_EXCLUDED_')) {
      throw new Error(`${site.id}/${fixtureCase.id} output contains excluded page chrome`);
    }
    auditSanitizedFixture(html, markdown);
    return {
      extractor: state.extractor,
      markdown,
      placement: state.placement as 'anchor' | 'floating',
      screenshot,
    };
  } finally {
    await page.close();
  }
}

export function readBuiltUserscript(): string {
  const file = path.join(ROOT, 'dist', 'userscript', 'copy-as-markdown.user.js');
  if (!fs.existsSync(file)) throw new Error('Build userscript first with pnpm build');
  return fs.readFileSync(file, 'utf8');
}

export function writeCapturedFixture(
  site: FixtureSite,
  fixtureCase: FixtureCase,
  captured: CapturedPage,
  verified: VerificationResult,
): string {
  const directory = fixtureDirectory(site, fixtureCase);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'page.html'), captured.html);
  fs.writeFileSync(path.join(directory, 'expected.md'), verified.markdown);
  fs.writeFileSync(path.join(directory, 'fixture.png'), verified.screenshot);
  fs.writeFileSync(path.join(directory, 'provenance.json'), `${JSON.stringify(captured.provenance, null, 2)}\n`);
  return directory;
}
