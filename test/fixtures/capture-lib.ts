import dns from 'node:dns/promises';
import { createHash } from 'node:crypto';
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
  digest?: string;
  digestAlgorithm?: 'sha256';
}

interface CapturedPage {
  html: string;
  provenance: FixtureProvenance;
  rawScreenshot: string;
  liveVerification?: { markdownChars: number; placement: 'anchor' | 'floating' };
  archiveMarkdownChars?: number;
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

export function assertContentPage(title: string, challengePresent: boolean): void {
  if (challengePresent || /^(?:just a moment|access denied|robot check|are you not a robot|security check|captcha|verify you are human|page not found|404(?:\s|$)|unusual traffic)(?:\b|\.\.\.)|^(?:sign in|sign up|log in)(?:\s*[-|·]|$)|^百度安全验证/i.test(title.trim())) {
    throw new Error(`Blocked or error page: ${title}`);
  }
}

async function checkContentPage(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    title: document.title,
    challengePresent: !!document.querySelector('#challenge-form, #cf-challenge-running, #challenge-running'),
  }));
  assertContentPage(state.title, state.challengePresent);
}

async function injectAndCheckPage(page: Page, scriptContent: string, site: FixtureSite, fixtureCase: FixtureCase) {
  await page.evaluate(scriptContent);
  await page.waitForSelector('#cam-copy-btn', { timeout: FIXTURE_TIMEOUT_MS });
  const extractor = await page.$eval('#cam-copy-btn', (button) =>
    (button as HTMLElement).dataset.camExtractor || '');
  if (extractor !== site.extractor) {
    throw new Error(`Live page routed to ${JSON.stringify(extractor)} instead of ${JSON.stringify(site.extractor)}`);
  }
  await page.$eval('#cam-copy-btn', (button) => button.scrollIntoView({ block: 'center', inline: 'center' }));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const placement = await page.$eval('#cam-copy-btn', (button) => {
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0
      || rect.right > innerWidth || rect.bottom > innerHeight) {
      throw new Error('Live copy button is outside the viewport or hidden');
    }
    return button.classList.contains('cam-floating') ? 'floating' as const : 'anchor' as const;
  });
  if (placement !== fixtureCase.placement) {
    throw new Error(`Original page used ${placement} placement instead of ${fixtureCase.placement}`);
  }
  const markdown = await captureMarkdown(page, fixtureCase.optionId);
  if (markdown.length < fixtureCase.minChars || markdown.length > fixtureCase.maxChars) {
    throw new Error(`Live copy produced ${markdown.length} chars outside ${fixtureCase.minChars}-${fixtureCase.maxChars}`);
  }
  for (const required of fixtureCase.contentRequired || []) {
    if (!markdown.includes(required)) throw new Error(`Live copy misses ${JSON.stringify(required)}`);
  }
  for (const forbidden of fixtureCase.forbidden || []) {
    if (markdown.includes(forbidden)) throw new Error(`Original copy contains ${JSON.stringify(forbidden)}`);
  }
  const sourceText = await page.evaluate((selectors) => selectors.map((selector) => ({
    selector, text: document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim(),
  })), fixtureCase.contentSelectors || []);
  for (const { selector, text } of sourceText) {
    if (!text || !markdown.includes(text)) throw new Error(`Original copy misses content from ${selector}`);
  }
  return { markdownChars: markdown.length, placement };
}

async function sanitizeRenderedPage(page: Page, excludedSelectors: string[], linkPrefixes: string[]): Promise<string> {
  return page.evaluate((selectors, prefixes) => {
    // Work in an inert document. Removing live custom elements can invoke site
    // lifecycle callbacks and corrupt the page while it is being captured.
    const snapshot = document.implementation.createHTMLDocument('');
    snapshot.replaceChild(snapshot.importNode(document.documentElement, true), snapshot.documentElement);
    const originals = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const copies = Array.from(snapshot.querySelectorAll<HTMLElement>('*'));
    for (let index = 0; index < originals.length; index += 1) {
      const element = originals[index];
      const copy = copies[index];
      if (element.shadowRoot) {
        const wrapper = snapshot.createElement('div');
        wrapper.setAttribute('data-fixture-shadow-root', 'open');
        wrapper.append(...Array.from(element.shadowRoot.childNodes).map((node) => snapshot.importNode(node, true)));
        copy.append(wrapper);
      }
      const style = getComputedStyle(element);
      if (element.hidden || element.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') copy.remove();
    }
    snapshot.querySelectorAll([
      '#wm-ipp', '#wm-ipp-base', '#wm-ipp-print', '#donato',
      '[data-cam-instance]', '#cam-styles', '#cam-toast-styles', '#cam-toast', '#cam-option-dialog',
    ].join(',')).forEach((element) => element.remove());

    snapshot.querySelectorAll([
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
      'data-target',
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

    for (const element of Array.from(snapshot.querySelectorAll('*'))) {
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
          let resolved = '';
          try { resolved = new URL(attribute.value, document.baseURI).href; } catch { /* Normalize malformed links too. */ }
          const prefix = prefixes.find((candidate) => resolved.startsWith(candidate));
          element.setAttribute(name, `${prefix || 'https://example.invalid/'}fixture-link-${String(linkToken).padStart(4, '0')}`);
        }
      }
    }

    const comments = snapshot.createTreeWalker(snapshot, NodeFilter.SHOW_COMMENT);
    const commentsToRemove: Node[] = [];
    while (comments.nextNode()) commentsToRemove.push(comments.currentNode);
    commentsToRemove.forEach((node) => node.parentNode?.removeChild(node));

    const textWalker = snapshot.createTreeWalker(snapshot.documentElement, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (textWalker.nextNode()) textNodes.push(textWalker.currentNode as Text);
    let textToken = 0;
    for (const node of textNodes) {
      if (!node.data.trim()) {
        node.data = node.data.replace(/\u00a0/g, ' ');
        continue;
      }
      textToken += 1;
      const tag = node.parentElement?.tagName.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TEXT';
      node.data = `FIXTURE_${tag}_${String(textToken).padStart(4, '0')}`;
    }

    selectors.forEach((selector, index) => {
      const elements = snapshot.querySelectorAll(selector);
      if (elements.length === 0) throw new Error(`Excluded selector not found: ${selector}`);
      const marker = `FIXTURE_EXCLUDED_${String(index + 1).padStart(4, '0')}`;
      elements.forEach((element) => element.prepend(snapshot.createTextNode(marker)));
    });

    if (snapshot.querySelectorAll('*').length > 30_000) {
      throw new Error('Sanitized page exceeds 30,000 elements');
    }
    return ('<!doctype html>\n' + snapshot.documentElement.outerHTML).replace(/[\t ]+$/gm, '');
  }, excludedSelectors, linkPrefixes);
}

async function captureCandidate(
  browser: Browser,
  site: FixtureSite,
  fixtureCase: FixtureCase,
  targetUrl: string,
  source: FixtureSource,
  scriptContent: string,
  workDirectory: string,
  archive?: WaybackCapture,
): Promise<{ html: string; rawScreenshot: string; liveVerification?: CapturedPage['liveVerification']; archiveMarkdownChars?: number; captureTimestamp?: string; responseSha256?: string }> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  fs.mkdirSync(workDirectory, { recursive: true });
  try {
    await configurePage(page);
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    if (!response || response.status() >= 400) {
      throw new Error(`${source} navigation returned HTTP ${response?.status() ?? 'unknown'}`);
    }
    const captureTimestamp = source === 'wayback'
      ? new URL(response.url()).pathname.match(/^\/web\/(\d{14})(?:id_)?\//)?.[1] : undefined;
    if (source === 'wayback' && !captureTimestamp) throw new Error('Wayback did not return an exact snapshot URL');
    if (archive?.digest && captureTimestamp !== archive.timestamp) {
      throw new Error(`Wayback redirected pinned snapshot ${archive.timestamp} to ${captureTimestamp}`);
    }
    const responseSha256 = source === 'wayback'
      ? createHash('sha256').update(await response.buffer()).digest('hex') : undefined;
    if (archive?.digestAlgorithm === 'sha256' && archive.digest !== responseSha256) {
      throw new Error('Wayback snapshot response does not match its pinned SHA-256 digest');
    }
    await checkContentPage(page);
    await settlePage(page, fixtureCase.readySelector);
    await checkContentPage(page);
    const liveVerification = source === 'live'
      ? await injectAndCheckPage(page, scriptContent, site, fixtureCase) : undefined;
    let archiveMarkdownChars: number | undefined;
    if (source === 'wayback') {
      // Check the archived rendered DOM at its original URL before anonymizing it.
      // Site scripts are removed and replay makes no outgoing network requests.
      const originalHtml = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, iframe, object, embed, #wm-ipp, #wm-ipp-base, #donato').forEach((node) => node.remove());
        return '<!doctype html>\n' + clone.outerHTML;
      });
      const originalPage = await openFixturePage(browser, originalHtml, fixtureCase.url);
      try {
        archiveMarkdownChars = (await injectAndCheckPage(originalPage, scriptContent, site, fixtureCase)).markdownChars;
      } finally {
        await originalPage.close();
      }
    }

    const rawScreenshot = path.join(workDirectory, `${source}.png`);
    await page.screenshot({ path: rawScreenshot, fullPage: false });
    const html = await sanitizeRenderedPage(page, fixtureCase.excludedSelectors || [], fixtureCase.linkPrefixes || []);
    return { html, rawScreenshot, liveVerification, archiveMarkdownChars, captureTimestamp, responseSha256 };
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
          liveMarkdownChars: captured.liveVerification?.markdownChars,
          livePlacement: captured.liveVerification?.placement,
        },
      };
    } catch (error) {
      liveError = error;
      if (requestedSource === 'live' || fixtureCase.wayback === false) throw error;
    }
  }

  try {
    const archive: WaybackCapture = typeof fixtureCase.wayback === 'object'
      ? {
          timestamp: fixtureCase.wayback.timestamp,
          original: fixtureCase.url,
          digest: fixtureCase.wayback.digest,
          digestAlgorithm: fixtureCase.wayback.digestAlgorithm,
        }
      : await discoverWaybackCapture(fixtureCase.url).catch(() => ({
          // Replay can discover an exact snapshot even when CDX is unavailable.
          timestamp: new Date().toISOString().replace(/\D/g, '').slice(0, 14),
          original: fixtureCase.url,
        }));
    const archiveUrl = `https://web.archive.org/web/${archive.timestamp}id_/${archive.original}`;
    const captured = await captureCandidate(
      browser, site, fixtureCase, archiveUrl, 'wayback', scriptContent, workDirectory, archive,
    );
    return {
      ...captured,
      provenance: {
        source: 'wayback',
        originalUrl: fixtureCase.url,
        capturedAt: new Date().toISOString(),
        captureTimestamp: captured.captureTimestamp,
        captureDigest: archive.digest || captured.responseSha256,
        captureDigestAlgorithm: archive.digestAlgorithm || (archive.digest ? undefined : 'sha256'),
        captureResponseSha256: captured.responseSha256,
        archiveMarkdownChars: captured.archiveMarkdownChars,
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
  const unsafeText = textSegments.find((text) => {
    const compact = text.replace(/\s+/g, '');
    return !/^FIXTURE_[A-Z0-9_]+$/.test(compact);
  });
  if (unsafeText) throw new Error(`Sanitized HTML contains non-synthetic text: ${unsafeText.slice(0, 80)}`);
}

async function openFixturePage(
  browser: Browser,
  html: string,
  url: string,
  scriptContent?: string,
): Promise<Page> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('globalThis.__name = globalThis.__name || ((value) => value);');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateTimezone('UTC');
  await page.setBypassCSP(true);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document'
      && request.frame() === page.mainFrame()) {
      request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      request.abort('blockedbyclient');
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
  if (scriptContent) {
    await page.evaluate(scriptContent);
    await page.waitForSelector('#cam-copy-btn', { timeout: FIXTURE_TIMEOUT_MS });
  }
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
