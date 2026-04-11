/**
 * Shared type definitions for Copy as Markdown.
 */

/** How the inline button should be visually styled to blend with the host site. */
export type AnchorStyle = 'tab' | 'icon' | 'link' | 'pill';

/** Where the button is inserted relative to the anchor element. */
export type AnchorPosition = 'append' | 'prepend' | 'before' | 'after';

/**
 * How the button should be placed for a given extractor.
 *
 * `floating` keeps the default bottom-right button.
 * `anchor` opts into using the extractor's AnchorConfig.
 */
export type ButtonPlacement = 'floating' | 'anchor';

/**
 * Describes where and how to inject the "Copy as Markdown" button
 * inline within the host page's own UI, so it feels native.
 *
 * The anchor config is only used when the extractor opts into
 * `buttonPlacement: 'anchor'`. Otherwise the button stays floating
 * in the bottom-right corner.
 */
export interface AnchorConfig {
  /** CSS selector for the container element to attach the button near. */
  selector: string;
  /** Where to place the button relative to the selector element. Default: 'append'. */
  position?: AnchorPosition;
  /** Visual preset so the button matches the host site's look. Default: 'pill'. */
  style?: AnchorStyle;
  /** Arbitrary CSS property overrides applied to the inline button. */
  css?: Record<string, string>;
  /** Custom label text (default: 'Copy as Markdown'). */
  label?: string;
}

/**
 * Configuration object passed to ExtractorRegistry.register().
 */
export interface ExtractorConfig {
  /** Human-readable site name (e.g. "Wikipedia"). */
  name: string;
  /** URL match patterns (userscript @match format). */
  matches: string[];
  /** Optional regex alternative to match patterns. */
  regex?: RegExp;
  /** The extraction function — returns a Markdown string. */
  extract: () => Promise<string>;
  /** Button placement mode. Default: 'floating'. */
  buttonPlacement?: ButtonPlacement;
  /** Optional inline button placement config. Only used when buttonPlacement is 'anchor'. */
  anchor?: AnchorConfig;
}

/**
 * Internal representation of a registered extractor.
 */
export interface Extractor {
  name: string;
  matches: string[];
  regex: RegExp | null;
  extract: () => Promise<string>;
  buttonPlacement: ButtonPlacement;
  anchor: AnchorConfig | null;
}

/**
 * Metadata key-value pairs rendered as YAML frontmatter.
 */
export type PageMetadata = Record<string, string | number | undefined>;
