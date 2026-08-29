/** Hugging Face model, dataset, and Space repository extractor. */

import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import type { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;
type RepositoryKind = 'model' | 'dataset' | 'space';

type RepositoryRoute = {
  kind: RepositoryKind;
  owner: string;
  name: string;
  repository: string;
  basePath: string;
  view: 'card' | 'tree';
  revision?: string;
  directory?: string;
};

type FileEntry = {
  path: string;
  type: 'directory' | 'file';
  href: string;
  size?: number;
  updated?: string;
};

const HEADER_TARGETS: Record<RepositoryKind, string> = {
  model: 'ModelHeader',
  dataset: 'DatasetHeader',
  space: 'SpaceHeader',
};

const REPOSITORY_KEYS: Record<RepositoryKind, string> = {
  model: 'model',
  dataset: 'dataset',
  space: 'space',
};

const MODEL_RESERVED_PATH_PREFIXES = [
  'agents', 'api', 'auth', 'blog', 'chat', 'collections', 'datasets', 'docs',
  'enterprise', 'inference', 'join', 'learn', 'login', 'models', 'oauth',
  'organizations', 'papers', 'posts', 'pricing', 'search', 'settings', 'spaces',
  'tasks',
];
const MODEL_RESERVED_PREFIXES = new Set(MODEL_RESERVED_PATH_PREFIXES);
const REPOSITORY_PATHNAME = new RegExp(
  `^/(?:datasets/[^/?#]+/[^/?#]+|spaces/[^/?#]+/[^/?#]+|(?!(?:${MODEL_RESERVED_PATH_PREFIXES.join('|')})(?:/|$))[^/?#]+/[^/?#]+)(?:/tree/[^/?#]+(?:/.*)?)?/?$`,
  'i',
);

export const huggingFaceExtractor = register({
  name: 'Hugging Face',
  matches: [
    '*://huggingface.co/*',
    '*://www.huggingface.co/*',
  ],
  pathnameRegex: REPOSITORY_PATHNAME,

  async extract() {
    const route = parseRoute(window.location.pathname);
    if (!route) return buildFallback();

    const repositoryData = getRepositoryData(route.kind);
    const title = getTitle(route, repositoryData);
    const metadata = buildMetadata(route, repositoryData, title);

    return route.view === 'tree'
      ? extractTree(route, metadata, repositoryData, title)
      : extractCard(route, metadata, repositoryData, title);
  },
});

function parseRoute(pathname: string): RepositoryRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  let kind: RepositoryKind;
  let ownerIndex: number;

  if (parts[0] === 'datasets' || parts[0] === 'spaces') {
    kind = parts[0] === 'datasets' ? 'dataset' : 'space';
    ownerIndex = 1;
  } else {
    kind = 'model';
    ownerIndex = 0;
    if (MODEL_RESERVED_PREFIXES.has((parts[0] || '').toLowerCase())) return null;
  }

  const owner = decodePart(parts[ownerIndex]);
  const name = decodePart(parts[ownerIndex + 1]);
  if (!owner || !name) return null;

  const baseLength = ownerIndex + 2;
  const suffix = parts.slice(baseLength);
  if (suffix.length === 0) {
    return {
      kind,
      owner,
      name,
      repository: `${owner}/${name}`,
      basePath: repositoryBasePath(kind, owner, name),
      view: 'card',
    };
  }
  if (suffix[0] !== 'tree' || !suffix[1]) return null;

  const revision = decodePart(suffix[1]);
  if (!revision) return null;
  const directory = suffix.slice(2).map(decodePart).join('/');
  return {
    kind,
    owner,
    name,
    repository: `${owner}/${name}`,
    basePath: repositoryBasePath(kind, owner, name),
    view: 'tree',
    revision,
    ...(directory ? { directory } : {}),
  };
}

function repositoryBasePath(kind: RepositoryKind, owner: string, name: string): string {
  const prefix = kind === 'model' ? '' : `/${kind === 'dataset' ? 'datasets' : 'spaces'}`;
  return `${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function decodePart(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function getRepositoryData(kind: RepositoryKind): JsonRecord | null {
  const target = HEADER_TARGETS[kind];
  const payload = parseDataProps(document.querySelector(`[data-target="${target}"]`));
  return asRecord(payload?.[REPOSITORY_KEYS[kind]]);
}

function parseDataProps(element: Element | null): JsonRecord | null {
  const raw = element?.getAttribute('data-props');
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function getTitle(route: RepositoryRoute, repositoryData: JsonRecord | null): string {
  if (route.kind === 'space') {
    const cardData = asRecord(repositoryData?.cardData);
    const title = stringValue(repositoryData?.title) || stringValue(cardData?.title);
    if (title) return title;
  }
  return stringValue(repositoryData?.id) || route.repository;
}

function buildMetadata(
  route: RepositoryRoute,
  repositoryData: JsonRecord | null,
  title: string,
): PageMetadata {
  const cardData = asRecord(repositoryData?.cardData);
  const metadata: PageMetadata = {
    source: 'Hugging Face',
    title,
    url: Utils.getCanonicalUrl(),
    repository: stringValue(repositoryData?.id) || route.repository,
    repository_type: route.kind,
    author: stringValue(repositoryData?.author) || route.owner,
  };
  addMetadata(metadata, 'created', repositoryData?.createdAt);
  addMetadata(metadata, 'updated', repositoryData?.lastModified);
  addMetadata(metadata, 'downloads', repositoryData?.downloads);
  addMetadata(metadata, 'likes', repositoryData?.likes);
  addMetadata(metadata, 'private', repositoryData?.private);
  addMetadata(metadata, 'gated', repositoryData?.gated);
  addMetadata(metadata, 'license', cardData?.license);
  addMetadata(metadata, 'pipeline_tag', repositoryData?.pipeline_tag || cardData?.pipeline_tag);
  addMetadata(metadata, 'library', repositoryData?.library_name || cardData?.library_name);
  if (route.view === 'tree') {
    metadata.revision = route.revision;
    if (route.directory) metadata.directory = route.directory;
  }
  return metadata;
}

function addMetadata(metadata: PageMetadata, key: string, value: unknown): void {
  const text = displayValue(value);
  if (text) metadata[key] = text;
}

function extractCard(
  route: RepositoryRoute,
  metadata: PageMetadata,
  repositoryData: JsonRecord | null,
  title: string,
): string {
  metadata.type = `${kindLabel(route.kind)} Repository`;
  metadata.truncated = 'false';

  const parts = [`# ${title}`, overviewMarkdown(route, repositoryData)];
  const tags = getTags(route.kind, repositoryData);
  if (tags.length > 0) {
    metadata.tags = tags.join(', ');
    parts.push(`## Tags\n\n${tags.map((tag) => `- ${tag}`).join('\n')}`);
  }

  const card = getRenderedCard(route.kind);
  let capturedCard = false;
  if (card) {
    const cardMarkdown = Markdown.elementToMarkdown(Utils.removeNoise(card, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[data-target="CopyButton"]',
      '.not-prose',
    ]));
    if (cardMarkdown) {
      parts.push(`## ${cardLabel(route.kind)}\n\n${cardMarkdown}`);
      capturedCard = true;
    }
  }

  if (route.kind === 'space') {
    const description = getSpaceDescription();
    if (description) parts.push(`## Description\n\n${description}`);
    parts.push('*Embedded Space app content is not included because it runs on a separate origin.*');
  }

  metadata.scope = capturedCard ? 'rendered repository card' : 'visible repository metadata';
  metadata.content_source = capturedCard ? 'rendered Hugging Face card DOM' : 'rendered Hugging Face header DOM';
  metadata.completeness = capturedCard ? 'complete_rendered_card' : 'metadata_only';
  metadata.complete = String(capturedCard);
  return Markdown.buildPageMarkdown(metadata, parts.filter(Boolean).join('\n\n'));
}

function overviewMarkdown(route: RepositoryRoute, repositoryData: JsonRecord | null): string {
  const cardData = asRecord(repositoryData?.cardData);
  const runtime = asRecord(repositoryData?.runtime);
  const hardware = asRecord(runtime?.hardware);
  const rows: Array<[string, unknown]> = [
    ['Repository', stringValue(repositoryData?.id) || route.repository],
    ['Type', kindLabel(route.kind)],
    ['Author', stringValue(repositoryData?.author) || route.owner],
    ['Created', repositoryData?.createdAt],
    ['Last modified', repositoryData?.lastModified],
    ['Downloads', repositoryData?.downloads],
    ['Likes', repositoryData?.likes],
    ['Private', repositoryData?.private],
    ['Gated', repositoryData?.gated],
  ];

  if (route.kind === 'model') {
    rows.push(
      ['Pipeline tag', repositoryData?.pipeline_tag || cardData?.pipeline_tag],
      ['Library', repositoryData?.library_name || cardData?.library_name],
      ['License', cardData?.license],
      ['Languages', cardData?.language],
      ['Base models', cardData?.base_model],
      ['Datasets', cardData?.datasets],
    );
  } else if (route.kind === 'dataset') {
    rows.push(
      ['Display name', cardData?.pretty_name],
      ['License', cardData?.license],
      ['Languages', cardData?.language],
      ['Tasks', cardData?.task_categories],
      ['Size categories', cardData?.size_categories],
    );
  } else {
    rows.push(
      ['SDK', repositoryData?.sdk || cardData?.sdk],
      ['SDK version', repositoryData?.sdkVersion || cardData?.sdk_version],
      ['App file', cardData?.app_file],
      ['License', cardData?.license],
      ['Runtime', runtime?.stage],
      ['Hardware', hardware?.current],
    );
  }

  const renderedRows = rows.flatMap(([label, value]) => {
    const display = displayValue(value);
    return display ? [[label, display]] : [];
  });
  if (renderedRows.length === 0) return '';
  return [
    '## Repository Metadata',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...renderedRows.map(([label, value]) =>
      `| ${Markdown.escapeMarkdownTableCell(label)} | ${Markdown.escapeMarkdownTableCell(value)} |`,
    ),
  ].join('\n');
}

function getTags(kind: RepositoryKind, repositoryData: JsonRecord | null): string[] {
  const cardData = asRecord(repositoryData?.cardData);
  const tags = uniqueStrings([
    ...stringArray(repositoryData?.tags),
    ...stringArray(cardData?.tags),
  ]);
  if (tags.length > 0) return tags;

  const header = document.querySelector(`[data-target="${HEADER_TARGETS[kind]}"]`);
  return uniqueStrings(Array.from(header?.querySelectorAll('.tag') || [])
    .map((element) => element.textContent?.trim() || ''));
}

function getRenderedCard(kind: RepositoryKind): Element | null {
  if (kind === 'model') return document.querySelector('.model-card-content');
  if (kind === 'dataset') {
    return document.querySelector(
      '.dataset-card-content, main .prose.hf-sanitized.copiable-code-container',
    );
  }
  return document.querySelector('.space-card-content');
}

function getSpaceDescription(): string {
  const description = Utils.getMeta('description');
  if (/advance and democratize artificial intelligence/i.test(description)) return '';
  return description;
}

function extractTree(
  route: RepositoryRoute,
  metadata: PageMetadata,
  repositoryData: JsonRecord | null,
  title: string,
): string {
  metadata.type = `${kindLabel(route.kind)} Repository Directory`;
  metadata.scope = 'visible directory listing';
  metadata.content_source = 'rendered Hugging Face directory DOM';
  metadata.completeness = 'visible_directory_only';
  metadata.complete = 'false';
  metadata.truncated = 'false';

  const entries = getFileEntries(route);
  metadata.entries = String(entries.length);
  metadata.files = String(entries.filter(({ type }) => type === 'file').length);
  metadata.directories = String(entries.filter(({ type }) => type === 'directory').length);

  const location = route.directory ? `${route.repository}/${route.directory}` : route.repository;
  const parts = [
    `# ${title}: ${route.directory || 'Files'}`,
    overviewMarkdown(route, repositoryData),
    `**Revision:** \`${route.revision}\``,
  ];

  if (entries.length > 0) {
    parts.push([
      '## Visible Files',
      '',
      '| Type | Path | Size | Updated |',
      '| --- | --- | ---: | --- |',
      ...entries.map((entry) => {
        const label = escapeTableLinkText(entry.path);
        const path = `[${label}](${escapeMarkdownDestination(entry.href)})`;
        return `| ${entry.type} | ${path} | ${formatBytes(entry.size)} | ${Markdown.escapeMarkdownTableCell(entry.updated || '')} |`;
      }),
    ].join('\n'));
  } else {
    parts.push(`*No file entries found in rendered directory for ${location}.*`);
  }
  parts.push('*Listing includes current directory entries exposed by rendered page; it does not recurse or fetch unrendered entries.*');
  return Markdown.buildPageMarkdown(metadata, parts.filter(Boolean).join('\n\n'));
}

function escapeTableLinkText(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\(/g, '&#40;')
    .replace(/\)/g, '&#41;')
    .replace(/([\\[\]|])/g, '\\$1');
}

function getFileEntries(route: RepositoryRoute): FileEntry[] {
  const viewer = document.querySelector('[data-target="ViewerIndexTreeList"]');
  const payload = parseDataProps(viewer);
  const fromPayload = recordArray(payload?.entries).flatMap((entry) => {
    const path = stringValue(entry.path);
    const type = entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : null;
    if (!path || !type) return [];
    const lastCommit = asRecord(entry.lastCommit);
    return [{
      path,
      type,
      href: entryHref(route, type, path),
      ...(numberValue(entry.size) !== undefined ? { size: numberValue(entry.size) } : {}),
      ...(stringValue(lastCommit?.date) ? { updated: stringValue(lastCommit?.date) } : {}),
    } satisfies FileEntry];
  });
  if (fromPayload.length > 0) return uniqueEntries(fromPayload);

  const links = Array.from(viewer?.querySelectorAll<HTMLAnchorElement>('a[href]') || []);
  return uniqueEntries(links.flatMap((link) => {
    const href = safeRepositoryUrl(link.href);
    const parsed = href ? parseEntryLink(route, href) : null;
    if (!parsed) return [];
    const row = link.closest('li, [role="row"]');
    return [{
      ...parsed,
      href,
      ...(row?.querySelector('time')?.getAttribute('datetime')
        ? { updated: row.querySelector('time')?.getAttribute('datetime') || undefined }
        : {}),
    } satisfies FileEntry];
  }));
}

function entryHref(route: RepositoryRoute, type: FileEntry['type'], path: string): string {
  const view = type === 'directory' ? 'tree' : 'blob';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const relative = `${route.basePath}/${view}/${encodeURIComponent(route.revision || 'main')}/${encodedPath}`;
  return new URL(relative, window.location.origin).href;
}

function parseEntryLink(route: RepositoryRoute, href: string): Pick<FileEntry, 'path' | 'type'> | null {
  let parts: string[];
  try {
    const url = new URL(href, window.location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin) return null;
    parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  } catch {
    return null;
  }
  if (parts.some((part) => !part)) return null;

  const base = route.kind === 'model'
    ? [route.owner, route.name]
    : [route.kind === 'dataset' ? 'datasets' : 'spaces', route.owner, route.name];
  if (!base.every((part, index) => parts[index] === part)) return null;
  const view = parts[base.length];
  if (view !== 'tree' && view !== 'blob') return null;
  if (parts[base.length + 1] !== route.revision) return null;
  const path = parts.slice(base.length + 2).join('/');
  if (!path) return null;
  return { path, type: view === 'tree' ? 'directory' : 'file' };
}

function safeRepositoryUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin === window.location.origin ? url.href : '';
  } catch {
    return '';
  }
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function uniqueEntries(entries: FileEntry[]): FileEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '';
  if (value < 1_000) return `${value} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1_000;
    unit += 1;
  } while (amount >= 1_000 && unit < units.length - 1);
  const digits = amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits).replace(/\.0+$/, '')} ${units[unit]}`;
}

function kindLabel(kind: RepositoryKind): string {
  if (kind === 'model') return 'Model';
  if (kind === 'dataset') return 'Dataset';
  return 'Space';
}

function cardLabel(kind: RepositoryKind): string {
  if (kind === 'model') return 'Model Card';
  if (kind === 'dataset') return 'Dataset Card';
  return 'README';
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return stringArray(value).join(', ');
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (typeof item === 'number' || typeof item === 'boolean') return [String(item)];
    return [];
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonRecord => !!item)
    : [];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function buildFallback(): string {
  const title = Utils.getPageTitle() || 'Hugging Face';
  const metadata: PageMetadata = {
    source: 'Hugging Face',
    title,
    url: Utils.getCanonicalUrl(),
    completeness: 'visible_only',
    complete: 'false',
  };
  const main = document.querySelector('main, [role="main"]');
  const body = main
    ? Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS))
    : '*Could not extract page content.*';
  return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
}
