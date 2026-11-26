const NUMBER = String.raw`(?<![\d.,])(?:\d{1,3}(?:\s\d{3})+|\d(?:[\d.,]*\d)?)`;

/**
 * Read the count directly before or after a label word, such as "1.2K likes", "Comments: 5", or "Like 5".
 * A number elsewhere in the text is not a count.
 */
export function labeledCount(value: string, label: RegExp): string {
  if (!label.test(value)) return '';
  const words = `(?:${label.source})(?!\\p{L})`;
  const match = value.match(new RegExp(`(${NUMBER}\\s?[kmb]?)\\s*${words}`, 'iu'))
    || value.match(new RegExp(`(?<!\\p{L})${words}\\s*[:：]\\s*(${NUMBER}(?:\\s?[kmb](?!\\p{L}))?)`, 'iu'))
    || value.match(new RegExp(`(?<!\\p{L})${words}\\s*(${NUMBER}(?:\\s?[kmb])?)\\s*$`, 'iu'));
  return match ? match[1].replace(/\s/g, '') : '';
}
