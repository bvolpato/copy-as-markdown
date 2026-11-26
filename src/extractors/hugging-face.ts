/** Hugging Face model, dataset, and Space repository extractor. */

import { replaceMath } from '../core/ai-conversation';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import type { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;
type RepositoryKind = 'model' | 'dataset' | 'space';

type RepositoryView = 'card' | 'tree' | 'blob' | 'discussions' | 'commits' | 'commit';

type RepositoryRoute = {
  kind: RepositoryKind;
  owner: string;
  name: string;
  repository: string;
  basePath: string;
  view: RepositoryView;
  revision?: string;
  directory?: string;
  filePath?: string;
  subPath?: string;
};

type PageRoute =
  | { kind: 'paper'; id: string }
  | { kind: 'collection'; slug: string };

type ParsedRoute = RepositoryRoute | PageRoute;

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
// Profile tabs, such as /google/models
const PROFILE_TABS = ['models', 'datasets', 'spaces', 'collections', 'papers', 'buckets'];
const REPO_SUBVIEW = '(?:/(?:tree/[^/?#]+(?:/.*)?|blob/[^/?#]+/.+|discussions(?:/.*)?|commits(?:/.*)?|commit/[^/?#]+))?';
const REPOSITORY_PATHNAME = new RegExp(
  `^/(?:datasets/[^/?#]+/[^/?#]+${REPO_SUBVIEW}|spaces/[^/?#]+/[^/?#]+${REPO_SUBVIEW}|papers/[^/?#]+(?:/.*)?|collections/[^/?#]+(?:/.*)?|(?!(?:${MODEL_RESERVED_PATH_PREFIXES.join('|')})(?:/|$))[^/?#]+/(?!(?:${PROFILE_TABS.join('|')})/?$)[^/?#]+${REPO_SUBVIEW})/?$`,
  'i',
);

export const huggingFaceExtractor = register({
  name: 'Hugging Face',
  matches: [
    '*://huggingface.co/*',
    '*://www.huggingface.co/*',
    '*://hf.co/*',
    '*://www.hf.co/*',
  ],
  pathnameRegex: REPOSITORY_PATHNAME,

  async extract() {
    const route = parseRoute(window.location.pathname);
    if (!route) return buildFallback();
    if (route.kind === 'paper' || route.kind === 'collection') {
      return extractHubPage(route);
    }

    const headerData = getHeaderData(route.kind);
    const repositoryData = getRepositoryData(route.kind, headerData);
    const title = getTitle(route, repositoryData);
    const metadata = buildMetadata(route, repositoryData, title);

    if (route.view === 'tree') {
      return extractTree(route, metadata, repositoryData, headerData, title);
    }
    if (route.view === 'blob') {
      return extractBlob(route, metadata, repositoryData, headerData, title);
    }
    if (route.view === 'discussions' || route.view === 'commits' || route.view === 'commit') {
      return extractRepositorySubpage(route, metadata, repositoryData, headerData, title);
    }
    return extractCard(route, metadata, repositoryData, headerData, title);
  },
});

function parseRoute(pathname: string): ParsedRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  const firstLower = (parts[0] || '').toLowerCase();

  if (firstLower === 'papers' && parts[1]) {
    const id = parts.slice(1).map(decodePart).join('/');
    return id ? { kind: 'paper', id } : null;
  }
  if (firstLower === 'collections' && parts[1]) {
    const slug = parts.slice(1).map(decodePart).join('/');
    return slug ? { kind: 'collection', slug } : null;
  }

  let kind: RepositoryKind;
  let ownerIndex: number;

  if (firstLower === 'datasets' || firstLower === 'spaces') {
    kind = firstLower === 'datasets' ? 'dataset' : 'space';
    ownerIndex = 1;
  } else {
    kind = 'model';
    ownerIndex = 0;
    if (MODEL_RESERVED_PREFIXES.has(firstLower)) return null;
  }

  const owner = decodePart(parts[ownerIndex]);
  const name = decodePart(parts[ownerIndex + 1]);
  if (!owner || !name) return null;

  const baseRoute = {
    kind,
    owner,
    name,
    repository: `${owner}/${name}`,
    basePath: repositoryBasePath(kind, owner, name),
  };

  const suffix = parts.slice(ownerIndex + 2);
  if (suffix.length === 0) {
    return { ...baseRoute, view: 'card' };
  }

  const view = suffix[0].toLowerCase();
  if (view === 'tree' && suffix[1]) {
    const parsed = parseRevisionAndPath(suffix.slice(1));
    if (!parsed) return null;
    return {
      ...baseRoute,
      view: 'tree',
      revision: parsed.revision,
      ...(parsed.path ? { directory: parsed.path } : {}),
    };
  }
  if (view === 'blob' && suffix[1]) {
    const parsed = parseRevisionAndPath(suffix.slice(1));
    if (!parsed || !parsed.path) return null;
    return {
      ...baseRoute,
      view: 'blob',
      revision: parsed.revision,
      filePath: parsed.path,
    };
  }
  if (view === 'discussions' || view === 'commits') {
    const rest = suffix.slice(1).map(decodePart);
    if (rest.some((part) => !part)) return null;
    return {
      ...baseRoute,
      view,
      ...(rest.length ? { subPath: rest.join('/') } : {}),
    };
  }
  if (view === 'commit' && suffix[1] && suffix.length === 2) {
    const sha = decodePart(suffix[1]);
    if (!sha) return null;
    return {
      ...baseRoute,
      view: 'commit',
      revision: sha,
    };
  }
  return null;
}

function parseRevisionAndPath(segments: string[]): { revision: string; path: string } | null {
  if (segments.length === 0) return null;
  if (
    segments[0].toLowerCase() === 'refs'
    && segments[1]
    && segments[2]
    && /^(?:pr|convert|heads|tags)$/i.test(segments[1])
  ) {
    const refParts = segments.slice(0, 3).map(decodePart);
    if (refParts.some((part) => !part)) return null;
    const rest = segments.slice(3).map(decodePart);
    if (rest.some((part) => !part)) return null;
    return { revision: refParts.join('/'), path: rest.join('/') };
  }
  const revision = decodePart(segments[0]);
  if (!revision) return null;
  const rest = segments.slice(1).map(decodePart);
  if (rest.some((part) => !part)) return null;
  return { revision, path: rest.join('/') };
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

function getRepositoryData(
  kind: RepositoryKind,
  headerData: JsonRecord | null,
): JsonRecord | null {
  const repository = asRecord(headerData?.[REPOSITORY_KEYS[kind]]);
  if (kind !== 'model') return repository;

  const evaluation = parseDataProps(document.querySelector('[data-target="ModelEvalResults"]'));
  const inference = parseDataProps(document.querySelector('[data-target="InferenceWidget"]'));
  return mergeModelRecords([
    asRecord(asRecord(inference?.widgetData)?.model),
    asRecord(evaluation?.model),
    repository,
  ]);
}

function mergeModelRecords(records: Array<JsonRecord | null>): JsonRecord | null {
  if (records.every((record) => !record)) return null;
  const merged: JsonRecord = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record || {})) {
      const child = asRecord(value);
      merged[key] = child ? mergeModelRecords([asRecord(merged[key]), child]) : value;
    }
  }
  return merged;
}

function getHeaderData(kind: RepositoryKind): JsonRecord | null {
  return parseDataProps(document.querySelector(`[data-target="${HEADER_TARGETS[kind]}"]`));
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
  addMetadata(metadata, 'downloads', downloadValue(repositoryData));
  addMetadata(metadata, 'likes', repositoryData?.likes);
  addMetadata(metadata, 'private', repositoryData?.private);
  addMetadata(metadata, 'gated', repositoryData?.gated);
  addMetadata(metadata, 'license', cardData?.license);
  addMetadata(metadata, 'pipeline_tag', repositoryData?.pipeline_tag || cardData?.pipeline_tag);
  addMetadata(metadata, 'library', repositoryData?.library_name || cardData?.library_name);
  if (route.view === 'tree') {
    metadata.revision = route.revision;
    if (route.directory) metadata.directory = route.directory;
  } else if (route.view === 'blob') {
    metadata.revision = route.revision;
    if (route.filePath) metadata.file_path = route.filePath;
  } else if (route.view === 'commit' && route.revision) {
    metadata.revision = route.revision;
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
  headerData: JsonRecord | null,
  title: string,
): string {
  metadata.type = `${kindLabel(route.kind)} Repository`;
  metadata.truncated = 'false';

  const parts = [`# ${title}`, overviewMarkdown(route, repositoryData, headerData)];
  const tags = getTags(route.kind, repositoryData);
  if (tags.length > 0) {
    metadata.tags = tags.join(', ');
    parts.push(`## Tags\n\n${tags.map((tag) => `- ${tag}`).join('\n')}`);
  }
  appendStructuredMetadata(parts, route.kind, repositoryData);

  const card = getRenderedCard(route.kind);
  let capturedCard = false;
  if (card) {
    const cleaned = Utils.removeNoise(card, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[data-target="CopyButton"]',
      '.not-prose',
    ]);
    replaceMath(cleaned);
    const cardMarkdown = Markdown.elementToMarkdown(cleaned);
    if (cardMarkdown) {
      parts.push(`## ${cardLabel(route.kind)}\n\n${cardMarkdown}`);
      capturedCard = true;
    }
  }

  appendSidebarSections(parts, route.kind);

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

function overviewMarkdown(
  route: RepositoryRoute,
  repositoryData: JsonRecord | null,
  headerData: JsonRecord | null,
): string {
  const cardData = asRecord(repositoryData?.cardData);
  const publisher = asRecord(headerData?.author);
  const discussions = asRecord(headerData?.discussionsStats);
  const runtime = asRecord(repositoryData?.runtime);
  const hardware = asRecord(runtime?.hardware);
  const rows: Array<[string, unknown]> = [
    ['Repository', stringValue(repositoryData?.id) || route.repository],
    ['Type', kindLabel(route.kind)],
    ['Author', stringValue(repositoryData?.author) || route.owner],
    ['Publisher', publisher?.fullname],
    ['Created', repositoryData?.createdAt],
    ['Last modified', repositoryData?.lastModified],
    ['Downloads', downloadValue(repositoryData)],
    ['All-time downloads', repositoryData?.trackDownloads === false ? undefined : repositoryData?.downloadsAllTime],
    ['Likes', repositoryData?.likes],
    ['Private', repositoryData?.private],
    ['Gated', repositoryData?.gated],
    ['Commit', repositoryData?.sha],
    ['Region', repositoryData?.region],
    ['Community discussions', discussions?.total],
    ['Open discussions', discussions?.open],
    ['Closed discussions', discussions?.closed],
  ];

  if (route.kind === 'model') {
    rows.push(
      ['Pipeline tag', repositoryData?.pipeline_tag || cardData?.pipeline_tag],
      ['Library', repositoryData?.library_name || cardData?.library_name],
      ['License', cardData?.license],
      ['Languages', cardData?.language],
      ['Base models', cardData?.base_model],
      ['Base model relation', cardData?.base_model_relation],
      ['Quantized', repositoryData?.isQuantized],
      ['Inference status', repositoryData?.inference],
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

function downloadValue(repositoryData: JsonRecord | null): unknown {
  return repositoryData?.trackDownloads === false ? 'Not tracked' : repositoryData?.downloads;
}

function appendStructuredMetadata(
  parts: string[],
  kind: RepositoryKind,
  repositoryData: JsonRecord | null,
): void {
  // Copy repository metadata only. Header props also contain viewer permissions
  // and billing context, which are unrelated to the repository.
  const represented = new Set(['license', 'tags', 'pipeline_tag', 'library_name']);
  const overviewFields = kind === 'model'
    ? ['language', 'base_model', 'base_model_relation', 'datasets']
    : kind === 'dataset'
      ? ['pretty_name', 'language', 'task_categories', 'size_categories']
      : ['title', 'sdk', 'sdk_version', 'app_file'];
  overviewFields.forEach((key) => represented.add(key));
  const cardData = asRecord(repositoryData?.cardData);
  const additional = Object.fromEntries(Object.entries(cardData || {})
    .filter(([key]) => !represented.has(key) && !(kind === 'model' && key === 'model-index')));
  appendPropertyTable(parts, 'Card Metadata', additional);

  if (kind !== 'model') return;
  appendPropertyTable(parts, 'Model Configuration', repositoryData?.config);
  appendPropertyTable(parts, 'Safetensors', repositoryData?.safetensors);
  appendPropertyTable(parts, 'Transformers', repositoryData?.transformersInfo);
  appendPropertyTable(parts, 'Evaluation Results', repositoryData?.['model-index'] || cardData?.['model-index']);

  const providers = repositoryData?.availableInferenceProviders;
  if (Array.isArray(providers)) {
    if (providers.length > 0) {
      appendPropertyTable(parts, 'Inference Providers', providers);
    } else {
      parts.push('## Inference Providers\n\nThis model is not deployed by any Inference Provider.');
    }
  }
}

function appendPropertyTable(parts: string[], title: string, value: unknown): void {
  const rows = propertyRows(value);
  if (rows.length === 0) return;
  parts.push([
    `## ${title}`, '', '| Property | Value |', '| --- | --- |',
    ...rows.map(([key, text]) =>
      `| ${Markdown.escapeMarkdownTableCell(key)} | ${Markdown.escapeMarkdownTableCell(text)} |`,
    ),
  ].join('\n'));
}

function propertyRows(value: unknown, path = ''): Array<[string, string]> {
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      const text = displayValue(value);
      return text ? [[path || 'value', text]] : [];
    }
    return value.flatMap((item, index) => propertyRows(item, `${path}[${index}]`));
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record).flatMap(([key, child]) =>
      propertyRows(child, path ? `${path}.${key}` : key),
    );
  }
  const text = displayValue(value);
  return text ? [[path || 'value', text]] : [];
}

function appendSidebarSections(parts: string[], kind: RepositoryKind): void {
  const card = getRenderedCard(kind);
  const sections: Array<[RegExp, string]> = [
    [/^Model tree for\b/i, 'Model Tree'],
    [/^Collections? including\b/i, 'Collections'],
    [/^Spaces using\b/i, 'Spaces Using This Repository'],
    [/^Papers for\b/i, 'Related Papers'],
    [/^Evaluation results\b/i, 'Evaluation Results'],
  ];
  for (const heading of document.querySelectorAll('main h2')) {
    if (card?.contains(heading) || heading.closest('[role="dialog"], [hidden], .modal')) continue;
    let title = sections.find(([pattern]) => pattern.test(textOf(heading)))?.[1];
    if (!title) continue;
    if (title === 'Evaluation Results' && parts.some((part) => part.startsWith('## Evaluation Results\n'))) {
      title = 'Evaluation Results (Page)';
    }
    if (title === 'Spaces Using This Repository') {
      const count = textOf(heading).match(/\s(\d[\d,]*)$/)?.[1];
      if (count) title += ` (${count})`;
    }
    // Some sidebar headings share a wrapper with a "see all" link.
    let sectionHeader = heading;
    while (sectionHeader.parentElement
      && !sectionHeader.parentElement.matches('main, section, aside')
      && Array.from(sectionHeader.parentElement.children).every((child) =>
        child === sectionHeader || child.matches('a, button, svg, span'),
      )) {
      sectionHeader = sectionHeader.parentElement;
    }
    const container = document.createElement('div');
    if (sectionHeader !== heading) {
      const controls = sectionHeader.cloneNode(true) as Element;
      controls.querySelector('h2')?.remove();
      container.appendChild(controls);
    }
    for (let sibling = sectionHeader.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (/^H[1-3]$/.test(sibling.tagName)
        || sibling.querySelector('h2')
        || sibling.classList.contains('divider-column-vertical')
        || sibling.getAttribute('data-target') === 'ModelEvalResults') break;
      container.appendChild(sibling.cloneNode(true));
    }
    // Collection titles use headers, and linked Spaces use a nav container.
    const clean = Utils.removeNoise(container, [
      ...Utils.NOISE_SELECTORS.filter((selector) => selector !== 'header' && selector !== 'nav'),
      'button', '[hidden]', '#cam-copy-btn', '[data-cam-instance]',
    ]);
    // The shared converter skips nav tags. These contain repository links.
    for (const nav of clean.querySelectorAll('nav')) {
      const content = document.createElement('div');
      for (const attribute of nav.attributes) content.setAttribute(attribute.name, attribute.value);
      content.append(...Array.from(nav.childNodes));
      nav.replaceWith(content);
    }
    for (const time of clean.querySelectorAll('time[datetime]')) {
      time.textContent = time.getAttribute('datetime');
    }
    for (const link of clean.querySelectorAll('a[href]')) {
      const blocks = link.querySelectorAll('header, h3, h4, p, div');
      if (blocks.length === 0) continue;
      for (const block of blocks) {
        block.before(' ');
        block.after(' ');
      }
      link.textContent = textOf(link);
    }
    const markdown = Markdown.elementToMarkdown(clean);
    if (markdown) parts.push(`## ${title}\n\n${markdown}`);
  }
}

function textOf(element: Element): string {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
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
  headerData: JsonRecord | null,
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
    overviewMarkdown(route, repositoryData, headerData),
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
        return `| ${entry.type} | ${path} | ${entry.type === 'file' ? formatBytes(entry.size) : ''} | ${Markdown.escapeMarkdownTableCell(entry.updated || '')} |`;
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
  const encodedRevision = (route.revision || 'main').split('/').map(encodeURIComponent).join('/');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const relative = `${route.basePath}/${view}/${encodedRevision}/${encodedPath}`;
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
  if (!base.every((part, index) => parts[index]?.toLowerCase() === part.toLowerCase())) return null;
  const view = parts[base.length]?.toLowerCase();
  if (view !== 'tree' && view !== 'blob') return null;
  const revisionParts = (route.revision || '').split('/').filter(Boolean);
  if (revisionParts.length === 0) return null;
  if (!revisionParts.every((part, index) => parts[base.length + 1 + index] === part)) return null;
  const path = parts.slice(base.length + 1 + revisionParts.length).join('/');
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

function extractBlob(
  route: RepositoryRoute,
  metadata: PageMetadata,
  repositoryData: JsonRecord | null,
  headerData: JsonRecord | null,
  title: string,
): string {
  metadata.type = `${kindLabel(route.kind)} Repository File`;
  metadata.scope = 'rendered repository file';
  metadata.content_source = 'rendered Hugging Face file DOM';
  metadata.truncated = 'false';

  const parts = [
    `# ${title}: ${route.filePath || 'File'}`,
    overviewMarkdown(route, repositoryData, headerData),
    route.revision ? `**Revision:** \`${route.revision}\`` : '',
  ];

  const fileRoot = ['.blob-content', '[data-target="BlobContent"]', 'main .prose', 'main', '[role="main"]']
    .map((selector) => document.querySelector(selector))
    .find((element) => element !== null);
  let captured = false;
  if (fileRoot) {
    const source = renderedSource(fileRoot);
    const cleaned = Utils.removeNoise(fileRoot, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[data-target="CopyButton"]',
    ]);
    replaceMath(cleaned);
    const body = source === null
      ? Markdown.elementToMarkdown(cleaned).trim()
      : Markdown.fencedCodeToMarkdown(source, route.filePath?.match(/\.(\w+)$/)?.[1] || '');
    if (body) {
      parts.push(`## File Content\n\n${body}`);
      captured = true;
    }
  }
  metadata.completeness = captured ? 'complete_rendered_file' : 'metadata_only';
  metadata.complete = String(captured);
  return Markdown.buildPageMarkdown(metadata, parts.filter(Boolean).join('\n\n'));
}

/** Read the source lines of the code viewer. */
function renderedSource(root: Element): string | null {
  // Large files keep their full text beside a window of rendered rows.
  const text = root.querySelector('.blob-virtual .blob-text');
  if (text) return text.textContent || '';
  const rows = Array.from(root.querySelectorAll('tr[id^="L"]'));
  if (rows.length === 0) return null;
  return rows.map((row) => row.lastElementChild?.textContent || '').join('\n');
}

/** Diff tables depend on literal indentation. */
function fenceDiffs(root: Element): void {
  for (const table of root.querySelectorAll('table.d2h-diff-table')) {
    const lines = Array.from(table.querySelectorAll('.d2h-code-side-line, .d2h-code-line')).map((line) => {
      const content = line.querySelector('.d2h-code-line-ctn')?.textContent;
      if (content === undefined) return (line.textContent || '').trim();
      return `${line.querySelector('.d2h-code-line-prefix')?.textContent?.trim() || ' '}${content}`;
    });
    const pre = document.createElement('pre');
    pre.setAttribute('data-language', 'diff');
    pre.textContent = lines.join('\n');
    table.replaceWith(pre);
  }
}

function extractRepositorySubpage(
  route: RepositoryRoute,
  metadata: PageMetadata,
  repositoryData: JsonRecord | null,
  headerData: JsonRecord | null,
  title: string,
): string {
  const viewLabel = route.view === 'discussions'
    ? 'Discussions'
    : route.view === 'commits'
      ? 'Commits'
      : 'Commit';
  metadata.type = `${kindLabel(route.kind)} Repository ${viewLabel}`;
  metadata.scope = `rendered repository ${route.view}`;
  metadata.content_source = `rendered Hugging Face ${route.view} DOM`;
  metadata.truncated = 'false';

  const parts = [
    `# ${title}: ${viewLabel}`,
    overviewMarkdown(route, repositoryData, headerData),
    route.revision ? `**Commit:** \`${route.revision}\`` : '',
  ];

  const main = document.querySelector('main, [role="main"]');
  let captured = false;
  if (main) {
    const cleaned = Utils.removeNoise(main, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[data-target="CopyButton"]',
      `[data-target="${HEADER_TARGETS[route.kind]}"]`,
    ]);
    replaceMath(cleaned);
    fenceDiffs(cleaned);
    const body = Markdown.elementToMarkdown(cleaned).trim();
    if (body) {
      parts.push(body);
      captured = true;
    }
  }
  metadata.completeness = captured ? 'visible_only' : 'metadata_only';
  metadata.complete = String(captured);
  return Markdown.buildPageMarkdown(metadata, parts.filter(Boolean).join('\n\n'));
}

function extractHubPage(route: PageRoute): string {
  const main = document.querySelector('main, [role="main"]');
  const heading = main?.querySelector('h1');
  const title = (heading ? textOf(heading) : '')
    || Utils.getPageTitle().replace(/\s*[·|\-]\s*Hugging Face\s*$/i, '').trim()
    || (route.kind === 'paper' ? `Paper ${route.id}` : `Collection ${route.slug}`);
  const metadata: PageMetadata = {
    source: 'Hugging Face',
    type: route.kind === 'paper' ? 'Paper' : 'Collection',
    title,
    url: Utils.getCanonicalUrl(),
    completeness: 'visible_only',
  };
  if (route.kind === 'paper') metadata.paper_id = route.id;
  else metadata.collection = route.slug;

  let body = '';
  if (main) {
    const cleaned = Utils.removeNoise(main, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[data-target="CopyButton"]',
    ]);
    const firstH1 = cleaned.querySelector('h1');
    if (firstH1 && textOf(firstH1).toLowerCase() === title.toLowerCase()) {
      firstH1.remove();
    }
    replaceMath(cleaned);
    body = Markdown.elementToMarkdown(cleaned).trim();
  }
  metadata.complete = String(body.length > 0);
  const content = body ? `# ${title}\n\n${body}` : `# ${title}\n\n*Could not extract page content.*`;
  return Markdown.buildPageMarkdown(metadata, content);
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
