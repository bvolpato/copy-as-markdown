import { restoreMathSource } from './math-source';

/** Return a clone whose math and code languages survive Markdown conversion. */
export function prepareWikiContent(content: Element): Element {
  const clone = content.cloneNode(true) as Element;
  restoreMathSource(clone);
  for (const wrapper of clone.querySelectorAll('.mw-highlight[class*="mw-highlight-lang-"]')) {
    const language = wrapper.className.match(/\bmw-highlight-lang-([\w+#.-]+)/)?.[1];
    if (language && language !== 'text') wrapper.querySelector('pre')?.classList.add(`language-${language}`);
  }
  clone.querySelectorAll('.mw-highlight-copy-button').forEach((element) => element.remove());
  return clone;
}
