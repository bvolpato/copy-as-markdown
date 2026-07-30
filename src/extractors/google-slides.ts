/**
 * Google Slides extractor.
 *
 * Uses the authenticated HTML presentation view to capture every slide in
 * order, including slides outside the editor viewport. Plain-text export and
 * the visible editor DOM provide progressively narrower fallbacks.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const MAX_SLIDES = 200;
const BODY_LIMIT = 110_000;

type Slide = {
  number: number;
  title: string;
  body: string;
  notes: string;
};

type PresentationExtraction = {
  slides: Slide[];
  contentSource: string;
  complete: boolean;
  notesScope: string;
  unassignedNotes: string;
};

type SlideBlock = {
  markdown: string;
  text: string;
  top: number;
  left: number;
  fontSize: number;
};

register({
  name: 'Google Slides',
  matches: ['*://docs.google.com/presentation/d/*'],
  options: [
    {
      id: 'current',
      label: 'Current slide',
      description: 'Copy selected slide and its speaker notes.',
    },
    {
      id: 'all',
      label: 'All slides',
      description: 'Copy full deck in slide order.',
    },
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#docs-titlebar-share-client-button',
      '#docs-sidekick-button-container',
      '#workspace-onegoogle-pep-container',
      '.docs-titlebar-buttons > :last-child',
    ].join(', '),
    position: 'before',
    style: 'link',
    label: 'Copy as Markdown',
  },

  async extract(optionId) {
    const presentationId = getPresentationId();
    const title = getPresentationTitle();
    const activeSlideId = getLocationParameter('slide');
    const activeSlideNumber = getActiveSlideNumber();
    const metadata: Record<string, string | number | undefined> = {
      source: 'Google Slides',
      title,
      url: window.location.href,
      presentation_id: presentationId,
      active_slide_id: activeSlideId || undefined,
      active_slide_number: activeSlideNumber || undefined,
    };

    if (!presentationId) {
      addExtractionMetadata(metadata, {
        contentSource: 'Google Slides live page',
        total: 0,
        included: 0,
        truncated: false,
        complete: false,
      });
      return Markdown.buildPageMarkdown(
        metadata,
        `# ${title}\n\n*Could not determine the current presentation ID.*`,
      );
    }

    const liveNotes = extractLiveSpeakerNotes();
    let extraction: PresentationExtraction | null = null;
    try {
      const html = await fetchSlidesResource(buildSlidesUrl(presentationId, 'htmlpresent'), 'html');
      const slides = parseHtmlPresentation(html);
      if (slides.length > 0) {
        const notes = attachLiveNotes(slides, liveNotes, activeSlideNumber);
        extraction = {
          slides,
          contentSource: 'Google Slides authenticated HTML presentation',
          complete: true,
          notesScope: notes.scope,
          unassignedNotes: notes.unassigned,
        };
      }
    } catch (error) {
      console.warn('[Copy as Markdown] Google Slides HTML presentation failed', error);
    }

    if (!extraction) {
      try {
        const text = await fetchSlidesResource(buildSlidesUrl(presentationId, 'export/txt'), 'text');
        const slides = parseTextPresentation(text);
        if (slides.length > 0) {
          const notes = attachLiveNotes(slides, liveNotes, activeSlideNumber);
          extraction = {
            slides,
            contentSource: 'Google Slides authenticated plain-text export',
            complete: false,
            notesScope: notes.scope,
            unassignedNotes: notes.unassigned,
          };
        }
      } catch (error) {
        console.warn('[Copy as Markdown] Google Slides text export failed', error);
      }
    }

    if (!extraction) {
      const slides = extractVisibleSlides(activeSlideNumber);
      const notes = attachLiveNotes(slides, liveNotes, activeSlideNumber);
      extraction = {
        slides,
        contentSource: 'Google Slides visible editor DOM',
        complete: false,
        notesScope: notes.scope,
        unassignedNotes: notes.unassigned,
      };
    }

    if (optionId === 'current') {
      const exportedSlide = activeSlideNumber
        ? extraction.slides.find((slide) => slide.number === activeSlideNumber)
        : undefined;
      const visibleSlide = extractVisibleSlides(activeSlideNumber)[0];
      const currentSlide = exportedSlide || visibleSlide || extraction.slides[0];
      extraction = {
        ...extraction,
        slides: currentSlide ? [currentSlide] : [],
        complete: Boolean(currentSlide),
      };
    }

    return buildPresentationMarkdown(metadata, title, extraction);
  },
});

function getPresentationId(): string {
  return window.location.pathname.match(/\/presentation\/d\/([^/]+)/)?.[1] || '';
}

function getPresentationTitle(): string {
  const title =
    document.querySelector('.docs-title-input-label-inner')?.textContent?.trim()
    || document.querySelector('#docs-title-input-label-inner')?.textContent?.trim()
    || document.querySelector<HTMLInputElement>('.docs-title-input')?.value?.trim()
    || Utils.getPageTitle()
    || 'Google Slides';
  return title.replace(/\s*-\s*Google Slides$/, '').trim();
}

function getLocationParameter(name: string): string {
  const current = new URL(window.location.href);
  const queryValue = current.searchParams.get(name);
  if (queryValue) return queryValue;
  const hash = current.hash.replace(/^#/, '');
  if (!hash.includes('=')) return '';
  return new URLSearchParams(hash).get(name) || '';
}

function getActiveSlideNumber(): number | undefined {
  const selected = document.querySelector<HTMLElement>([
    '.punch-filmstrip-thumbnail-container.punch-filmstrip-thumbnail-selected',
    '.punch-filmstrip-thumbnail.punch-filmstrip-thumbnail-selected',
    '.punch-filmstrip-thumbnail-selection',
    '.punch-filmstrip-thumbnail-pagenumber-container.punch-filmstrip-thumbnail-selected',
    '.punch-filmstrip-thumbnail-selected',
    '.punch-filmstrip-selected-thumbnail',
    '[role="listitem"][aria-selected="true"]',
    '[aria-label^="Slide"][aria-selected="true"]',
  ].join(', '));
  if (!selected) return undefined;
  const container = selected.closest<HTMLElement>(
    '.punch-filmstrip-thumbnail-container, .punch-filmstrip-thumbnail, [role="listitem"]',
  ) || selected;
  const pageNumber = selected.querySelector<HTMLElement>(
    '.punch-filmstrip-thumbnail-pagenumber, .punch-filmstrip-thumbnail-pagenumber-container',
  );
  const explicitPosition = Number(container.getAttribute('aria-posinset'));
  if (Number.isFinite(explicitPosition) && explicitPosition > 0) return explicitPosition;
  const label = pageNumber?.textContent
    || container.getAttribute('aria-label')
    || selected.getAttribute('aria-label')
    || selected.textContent
    || '';
  const number = Number(label.match(/(?:slide\s*)?(\d+)/i)?.[1]);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function buildSlidesUrl(presentationId: string, endpoint: 'htmlpresent' | 'export/txt'): string {
  return new URL(`/presentation/d/${presentationId}/${endpoint}`, window.location.origin).href;
}

async function fetchSlidesResource(url: string, kind: 'html' | 'text'): Promise<string> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Google Slides request returned ${response.status}`);

  const text = await response.text();
  if (!text.trim()) throw new Error('Google Slides request returned an empty response');
  if (
    response.url.includes('ServiceLogin')
    || /accounts\.google\.com/i.test(text)
    || /<title>\s*sign in/i.test(text)
  ) {
    throw new Error('Google Slides request redirected to sign-in');
  }
  if (kind === 'text' && /^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error('Google Slides text export returned HTML');
  }
  return text;
}

function parseHtmlPresentation(html: string): Slide[] {
  const parsed = Markdown.parseHtmlDocument(html);
  const slideElements = Array.from(parsed.querySelectorAll<HTMLElement>([
    '.slide',
    '[data-slide-number]',
    '[aria-label^="Slide "]',
  ].join(', '))).filter((slide, index, all) =>
    !all.some((candidate, candidateIndex) => candidateIndex < index && candidate.contains(slide)),
  );
  return slideElements.map((slide, index) => extractHtmlSlide(slide, index + 1));
}

function extractHtmlSlide(slide: HTMLElement, fallbackNumber: number): Slide {
  const content = slide.querySelector<HTMLElement>('.slide-content') || slide;
  const label = slide.getAttribute('title') || content.getAttribute('aria-label') || '';
  const parsedNumber = Number(label.match(/(?:slide\s*)?(\d+)/i)?.[1]);
  const number = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : fallbackNumber;
  const blocks = extractPositionedBlocks(content);
  const titleBlock = chooseTitleBlock(blocks);
  const title = titleBlock?.text.replace(/[\r\n]+/g, ' ').trim() || '';
  const body = blocks
    .filter((block) => block !== titleBlock)
    .map((block) => block.markdown)
    .filter(Boolean)
    .join('\n\n');
  const notesElement = slide.querySelector<HTMLElement>('.slide-notes, [data-speaker-notes]');
  const notes = notesElement ? cleanBlockMarkdown(Markdown.elementToMarkdown(notesElement)) : '';

  if (blocks.length === 0) {
    return {
      number,
      title: '',
      body: cleanBlockMarkdown(Markdown.elementToMarkdown(content)),
      notes,
    };
  }
  return { number, title, body, notes };
}

function extractPositionedBlocks(content: HTMLElement): SlideBlock[] {
  const selector = [
    '.shape',
    '[data-shape-id]',
    '[role="textbox"]',
    'table',
    'ul',
    'ol',
    'svg',
  ].join(', ');
  const candidates = Array.from(content.querySelectorAll<HTMLElement>(selector)).filter((element, index, all) => {
    if (!normalizeText(element.textContent || element.getAttribute('aria-label') || '')) return false;
    return !all.some((candidate, candidateIndex) => candidateIndex < index && candidate.contains(element));
  });
  const blocks = candidates.map((element) => {
    const svgText = element.matches('svg')
      ? Array.from(element.querySelectorAll('text')).map((node) => normalizeText(node.textContent || '')).filter(Boolean).join('\n')
      : '';
    const markdown = cleanBlockMarkdown(svgText || Markdown.elementToMarkdown(element));
    return {
      markdown,
      text: normalizeText(element.textContent || ''),
      top: numericStyle(element.style.top),
      left: numericStyle(element.style.left),
      fontSize: largestFontSize(element),
    };
  }).filter((block) => block.text && block.markdown);

  const seen = new Set<string>();
  return blocks
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .filter((block) => {
      const key = normalizeText(block.markdown);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function chooseTitleBlock(blocks: SlideBlock[]): SlideBlock | undefined {
  const candidates = blocks.filter((block) => block.text.length <= 240 && block.top <= 320);
  if (candidates.length === 0) return blocks[0];
  return candidates.reduce((best, block) => {
    const bestScore = best.fontSize * 100 - best.top * 0.1 - best.text.length * 0.01;
    const score = block.fontSize * 100 - block.top * 0.1 - block.text.length * 0.01;
    return score > bestScore ? block : best;
  });
}

function largestFontSize(element: HTMLElement): number {
  const values = [element, ...Array.from(element.querySelectorAll<HTMLElement>('[style*="font-size"]'))]
    .map((candidate) => numericStyle(candidate.style.fontSize))
    .filter((value) => value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
}

function numericStyle(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTextPresentation(text: string): Slide[] {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  let sections = normalized.split(/\f+/).map((section) => section.trim()).filter(Boolean);
  if (sections.length <= 1) {
    const marked = normalized.split(/(?=^\s*Slide\s+\d+(?:\s*[:.-]|\s*$))/gmi)
      .map((section) => section.trim())
      .filter(Boolean);
    sections = marked.length > 1 ? marked : [normalized.trim()].filter(Boolean);
  }
  return sections.map((section, index) => {
    const lines = section.replace(/[\u000b]+/g, '\n').split('\n').map(normalizeText).filter(Boolean);
    const marker = lines[0]?.match(/^Slide\s+(\d+)\s*(?::|-)?\s*(.*)$/i);
    const number = Number(marker?.[1]) || index + 1;
    const markerTitle = marker?.[2]?.trim() || '';
    const contentLines = marker ? lines.slice(1) : lines;
    return {
      number,
      title: markerTitle || contentLines[0] || '',
      body: contentLines.slice(markerTitle ? 0 : 1).join('\n'),
      notes: '',
    };
  });
}

function extractVisibleSlides(activeSlideNumber?: number): Slide[] {
  const roots = Array.from(document.querySelectorAll<HTMLElement>([
    '.punch-viewer-content .slide',
    '.punch-viewer-content .slide-content',
    '.punch-editor-page-container .punch-editor-page',
    '[aria-roledescription="Content"][aria-label^="Slide"]',
  ].join(', ')));
  const uniqueRoots = roots.filter((root, index) =>
    !roots.some((candidate, candidateIndex) => candidateIndex < index && candidate.contains(root)),
  );

  return uniqueRoots.map((root, index) => {
    const label = root.getAttribute('aria-label') || '';
    const labeledNumber = Number(label.match(/(?:slide\s*)?(\d+)/i)?.[1]);
    const number = Number.isFinite(labeledNumber) && labeledNumber > 0
      ? labeledNumber
      : uniqueRoots.length === 1 && activeSlideNumber ? activeSlideNumber : index + 1;
    if (root.matches('.slide') || root.querySelector('.shape')) {
      return extractHtmlSlide(root, number);
    }

    const titleElement = root.querySelector<HTMLElement>(
      '[aria-label*="title placeholder" i], [data-placeholder-type="TITLE"]',
    );
    const title = normalizeText(titleElement?.textContent || '');
    const textElements = Array.from(root.querySelectorAll<HTMLElement>(
      '.sketchy-text-content-text, [role="textbox"], svg text',
    ));
    const values: string[] = [];
    const seen = new Set<string>();
    textElements.forEach((element) => {
      if (titleElement?.contains(element) || element.contains(titleElement)) return;
      const value = normalizeText(element.textContent || element.getAttribute('aria-label') || '');
      if (!value || seen.has(value)) return;
      seen.add(value);
      values.push(value);
    });
    return { number, title, body: values.join('\n\n'), notes: '' };
  }).filter((slide) => slide.title || slide.body);
}

function extractLiveSpeakerNotes(): string {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '.punch-speaker-notes-text-body',
    '.punch-speaker-notes [contenteditable="true"]',
    '[aria-label*="speaker notes" i] [contenteditable="true"]',
    '[aria-label*="speaker notes" i]',
  ].join(', ')));
  const values = candidates.map((element) => normalizeText(element.textContent || ''))
    .filter((value) => value && !/^(?:click to add )?speaker notes$/i.test(value));
  return values.sort((left, right) => right.length - left.length)[0] || '';
}

function attachLiveNotes(
  slides: Slide[],
  notes: string,
  activeSlideNumber?: number,
): { scope: string; unassigned: string } {
  if (!notes) return { scope: 'not available from export or visible DOM', unassigned: '' };
  const target = activeSlideNumber
    ? slides.find((slide) => slide.number === activeSlideNumber)
    : slides.length === 1 ? slides[0] : undefined;
  if (target) {
    target.notes = target.notes || notes;
    return { scope: `active slide ${target.number}`, unassigned: '' };
  }
  return {
    scope: activeSlideNumber ? `active slide ${activeSlideNumber}` : 'active slide (number unavailable)',
    unassigned: notes,
  };
}

function buildPresentationMarkdown(
  metadata: Record<string, string | number | undefined>,
  title: string,
  extraction: PresentationExtraction,
): string {
  const limitedSlides = limitCollection(extraction.slides, MAX_SLIDES);
  const slides = limitedSlides.items.map(renderSlide);
  if (extraction.unassignedNotes) {
    slides.push(`## Speaker notes (active slide)\n\n${extraction.unassignedNotes}`);
  }
  const rendered = slides.join('\n\n');
  const content = rendered || '*No slide text was available. Wait for the presentation to load and try again.*';
  const body = limitMarkdown(`# ${escapeHeading(title)}\n\n${content}`, BODY_LIMIT);
  const truncated = limitedSlides.truncated || body.truncated;

  metadata.slides_total = extraction.slides.length;
  metadata.slides_included = limitedSlides.items.length;
  metadata.speaker_notes = extraction.notesScope;
  metadata.output_limits = `${MAX_SLIDES} slides, ${BODY_LIMIT} characters`;
  addExtractionMetadata(metadata, {
    contentSource: extraction.contentSource,
    total: extraction.slides.length,
    included: limitedSlides.items.length,
    truncated,
    complete: extraction.complete && !truncated,
  });
  return Markdown.buildPageMarkdown(metadata, body.markdown);
}

function renderSlide(slide: Slide): string {
  const heading = slide.title
    ? `## Slide ${slide.number}: ${escapeHeading(slide.title)}`
    : `## Slide ${slide.number}`;
  const parts = [heading];
  if (slide.body) parts.push(slide.body);
  if (slide.notes) parts.push(`### Speaker notes\n\n${slide.notes}`);
  if (!slide.body && !slide.notes) parts.push('*No text on this slide.*');
  return parts.join('\n\n');
}

function cleanBlockMarkdown(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[\s\r\n]+/g, ' ').trim();
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/#+\s*$/, '').trim() || 'Google Slides';
}
