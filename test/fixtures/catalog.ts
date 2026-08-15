import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(FIXTURES_DIR, '../..');
export const SITES_DIR = path.join(ROOT, 'test', 'sites');
export const WORK_DIR = path.join(ROOT, '.fixture-work');

export type CaptureSource = 'auto' | 'live' | 'wayback';
export type FixtureSource = 'live' | 'wayback' | 'synthetic';
export type Placement = 'anchor' | 'floating';
export type AnchorPosition = 'append' | 'prepend' | 'before' | 'after' | 'overlay';

export interface FixtureCase {
  id: string;
  url: string;
  readySelector: string;
  placement: Placement;
  anchorSelector?: string;
  anchorPosition?: AnchorPosition;
  minChars: number;
  maxChars: number;
  required?: string[];
  forbidden?: string[];
  excludedSelectors?: string[];
  optionId?: string;
  wayback?: boolean | {
    timestamp: string;
    digest: string;
  };
}

export interface FixtureSite {
  id: string;
  extractor: string;
  cases: FixtureCase[];
}

export interface FixtureCatalog {
  version: number;
  sites: FixtureSite[];
}

export interface FixtureProvenance {
  source: FixtureSource;
  originalUrl: string;
  capturedAt: string;
  captureTimestamp?: string;
  captureDigest?: string;
  sanitizerVersion: number;
}

function assertIdentifier(value: unknown, context: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`${context} must contain lowercase letters, numbers, or hyphens`);
  }
}

export function loadCatalog(): FixtureCatalog {
  const catalogPath = path.join(SITES_DIR, 'catalog.yaml');
  const catalog = parse(fs.readFileSync(catalogPath, 'utf8')) as FixtureCatalog;
  if (catalog?.version !== 1 || !Array.isArray(catalog.sites) || catalog.sites.length === 0) {
    throw new Error('test/sites/catalog.yaml must contain version 1 and at least one site');
  }

  const siteIds = new Set<string>();
  for (const site of catalog.sites) {
    assertIdentifier(site.id, 'Site id');
    if (siteIds.has(site.id)) throw new Error(`Duplicate site id: ${site.id}`);
    siteIds.add(site.id);
    if (typeof site.extractor !== 'string' || !site.extractor.trim()) {
      throw new Error(`${site.id} must name an extractor`);
    }
    if (!Array.isArray(site.cases) || site.cases.length === 0) {
      throw new Error(`${site.id} must contain at least one case`);
    }

    const caseIds = new Set<string>();
    for (const fixtureCase of site.cases) {
      assertIdentifier(fixtureCase.id, `${site.id} case id`);
      if (caseIds.has(fixtureCase.id)) {
        throw new Error(`Duplicate case id: ${site.id}/${fixtureCase.id}`);
      }
      caseIds.add(fixtureCase.id);
      if (!fixtureCase.url || !fixtureCase.readySelector) {
        throw new Error(`${site.id}/${fixtureCase.id} requires url and readySelector`);
      }
      if (!['anchor', 'floating'].includes(fixtureCase.placement)) {
        throw new Error(`${site.id}/${fixtureCase.id} has invalid placement`);
      }
      if (fixtureCase.placement === 'anchor'
        && (!fixtureCase.anchorSelector
          || !['append', 'prepend', 'before', 'after', 'overlay'].includes(fixtureCase.anchorPosition || ''))) {
        throw new Error(`${site.id}/${fixtureCase.id} requires anchorSelector and anchorPosition`);
      }
      if (!(fixtureCase.minChars > 0) || fixtureCase.maxChars < fixtureCase.minChars) {
        throw new Error(`${site.id}/${fixtureCase.id} has invalid output bounds`);
      }
      if (fixtureCase.excludedSelectors?.some((selector) => !selector.trim())) {
        throw new Error(`${site.id}/${fixtureCase.id} has an empty excluded selector`);
      }
      if (typeof fixtureCase.wayback === 'object'
        && (!/^\d{14}$/.test(fixtureCase.wayback.timestamp)
          || !/^[A-Z2-7]+$/.test(fixtureCase.wayback.digest))) {
        throw new Error(`${site.id}/${fixtureCase.id} has invalid Wayback pin`);
      }
    }
  }
  return catalog;
}

export function findCatalogCase(catalog: FixtureCatalog, siteId: string, caseId?: string) {
  const site = catalog.sites.find((candidate) => candidate.id === siteId);
  if (!site) throw new Error(`Unknown fixture site: ${siteId}`);
  const fixtureCase = caseId
    ? site.cases.find((candidate) => candidate.id === caseId)
    : site.cases[0];
  if (!fixtureCase) throw new Error(`Unknown fixture case: ${siteId}/${caseId}`);
  return { site, fixtureCase };
}

export function fixtureDirectory(site: FixtureSite, fixtureCase: FixtureCase): string {
  return path.join(SITES_DIR, site.id, fixtureCase.id);
}
