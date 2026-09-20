#!/usr/bin/env tsx

import puppeteer from 'puppeteer';
import {
  type CaptureSource,
  findCatalogCase,
  loadCatalog,
} from './catalog';
import {
  capturePublicFixture,
  readBuiltUserscript,
  verifyFixtureHtml,
  writeCapturedFixture,
} from './capture-lib';

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const siteId = readArgument('--site');
  const all = process.argv.includes('--all');
  if (!siteId && !all) {
    throw new Error('Usage: pnpm fixtures:capture -- --site <site> [--case <case>] [--source auto|live|wayback], or --all');
  }
  const caseId = readArgument('--case');
  if (all && (siteId || caseId)) throw new Error('--all cannot be combined with --site or --case');
  const source = (readArgument('--source') || 'auto') as CaptureSource;
  if (!['auto', 'live', 'wayback'].includes(source)) throw new Error(`Invalid source: ${source}`);

  const catalog = loadCatalog();
  const cases = all
    ? catalog.sites.flatMap((site) => site.cases.map((fixtureCase) => ({ site, fixtureCase })))
    : [findCatalogCase(catalog, siteId!, caseId)];
  const scriptContent = readBuiltUserscript();
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const failures: string[] = [];
  try {
    for (const { site, fixtureCase } of cases) {
      console.log(`Capturing ${site.id}/${fixtureCase.id} from ${source} source...`);
      try {
        const captured = await capturePublicFixture(browser, site, fixtureCase, source, scriptContent);
        const verified = await verifyFixtureHtml(browser, site, fixtureCase, captured.html, scriptContent);
        const directory = writeCapturedFixture(site, fixtureCase, captured, verified);
        console.log(`Source: ${captured.provenance.source}`);
        console.log(`Extractor: ${verified.extractor}`);
        console.log(`Placement: ${verified.placement}`);
        console.log(`Markdown: ${verified.markdown.length} chars`);
        console.log(`Raw screenshot: ${captured.rawScreenshot}`);
        console.log(`Sanitized fixture: ${directory}`);
      } catch (error) {
        const message = `${site.id}/${fixtureCase.id}: ${error instanceof Error ? error.message : error}`;
        failures.push(message);
        console.error(message);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`${failures.length} capture(s) failed:\n${failures.join('\n')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
