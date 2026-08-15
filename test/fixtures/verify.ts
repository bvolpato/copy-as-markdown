#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  fixtureDirectory,
  loadCatalog,
  type FixtureProvenance,
} from './catalog';
import {
  auditSanitizedFixture,
  readBuiltUserscript,
  SANITIZER_VERSION,
  verifyFixtureHtml,
} from './capture-lib';

async function main(): Promise<void> {
  const catalog = loadCatalog();
  const scriptContent = readBuiltUserscript();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let verifiedCount = 0;
  try {
    for (const site of catalog.sites) {
      for (const fixtureCase of site.cases) {
        const directory = fixtureDirectory(site, fixtureCase);
        const requiredFiles = ['page.html', 'expected.md', 'fixture.png', 'provenance.json'];
        for (const file of requiredFiles) {
          if (!fs.existsSync(path.join(directory, file))) {
            throw new Error(`Missing fixture file: ${site.id}/${fixtureCase.id}/${file}`);
          }
        }

        const html = fs.readFileSync(path.join(directory, 'page.html'), 'utf8');
        const expected = fs.readFileSync(path.join(directory, 'expected.md'), 'utf8');
        const provenance = JSON.parse(
          fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'),
        ) as FixtureProvenance;
        if (provenance.originalUrl !== fixtureCase.url) {
          throw new Error(`${site.id}/${fixtureCase.id} provenance URL does not match catalog`);
        }
        if (provenance.sanitizerVersion !== SANITIZER_VERSION) {
          throw new Error(`${site.id}/${fixtureCase.id} uses sanitizer version ${provenance.sanitizerVersion}; expected ${SANITIZER_VERSION}`);
        }
        if (provenance.source === 'wayback'
          && (!provenance.captureTimestamp || !provenance.captureDigest)) {
          throw new Error(`${site.id}/${fixtureCase.id} Wayback provenance lacks timestamp or digest`);
        }
        auditSanitizedFixture(html, expected);
        const result = await verifyFixtureHtml(browser, site, fixtureCase, html, scriptContent);
        if (result.markdown !== expected) {
          throw new Error(`${site.id}/${fixtureCase.id} Markdown differs from expected.md`);
        }
        verifiedCount += 1;
        console.log(`✓ ${site.id}/${fixtureCase.id}: ${result.extractor}, ${result.markdown.length} chars`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Verified ${verifiedCount} sanitized captured fixture${verifiedCount === 1 ? '' : 's'}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
