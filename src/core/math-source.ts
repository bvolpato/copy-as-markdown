/**
 * Replace rendered math in a detached clone with its TeX source.
 * These renderers hide the source, draw it as SVG, or repeat it. The converter reads KaTeX, LaTeXML, and plain MathML itself.
 */
export function restoreMathSource(root: Element): void {
  const replace = (target: Element, tex: string, isBlock: boolean): void => {
    const source = cleanTex(tex);
    if (!source) return;
    // The converter escapes the backslashes of cell text, but not those of a math element.
    const inCell = target.closest('td, th') !== null;
    const replacement = target.ownerDocument.createElement(inCell ? 'math' : isBlock ? 'div' : 'span');
    if (inCell) replacement.setAttribute('alttext', source);
    else replacement.textContent = isBlock ? `$$${source}$$` : `$${source}$`;
    target.replaceWith(replacement);
  };

  const wikiMath = Array.from(root.querySelectorAll(
    '.mwe-math-element, .mwe-math-fallback-image-inline, .mwe-math-fallback-image-display',
  )).filter((element) => !element.parentElement?.closest('.mwe-math-element'));
  for (const element of wikiMath) {
    const isBlock = element.matches('.mwe-math-element-block, .mwe-math-fallback-image-display, [display="block"]')
      || Boolean(element.querySelector('.mwe-math-mathml-display, .mwe-math-fallback-image-display'));
    const hidden = element.closest('.mwe-math-mathml-a11y');
    const tex = wikiTex(element, root);
    if (tex) replace(hidden || element, tex, isBlock);
    else hidden?.replaceWith(element);
  }
  // MathJax redraws MediaWiki math beside the hidden element.
  if (wikiMath.length > 0) root.querySelectorAll('mjx-container').forEach((element) => element.remove());

  root.querySelectorAll('math[data-latex]').forEach((element) => {
    replace(
      element.closest('math-renderer') || element,
      element.getAttribute('data-latex') || '',
      element.getAttribute('display') === 'block' || Boolean(element.closest('.js-display-math')),
    );
  });

  // MathJax 2 keeps the source in a script after its preview and its output.
  root.querySelectorAll('script[type^="math/tex"]').forEach((script) => {
    while (script.previousElementSibling?.matches('[class^="MathJax"], [class^="MJX"], .MathJax_CHTML, .MJXc-display')) {
      script.previousElementSibling.remove();
    }
    replace(script, script.textContent || '', /mode\s*=\s*display/.test(script.getAttribute('type') || ''));
  });
}

function cleanTex(value: string): string {
  return value.trim()
    .replace(/^\{\\(?:display|text)style\s*([\s\S]*)\}$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function wikiTex(element: Element, root: Element): string {
  const about = element.getAttribute('about');
  const owner = element.hasAttribute('data-mw') || !about
    ? element
    : root.querySelector(`[data-mw][about="${CSS.escape(about)}"]`);
  return extensionSource(owner?.getAttribute('data-mw'))
    || element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    || element.querySelector('math[alttext]')?.getAttribute('alttext')
    || (element.matches('img') ? element : element.querySelector('img[alt]'))?.getAttribute('alt')
    || '';
}

function extensionSource(dataMw: string | null | undefined): string {
  if (!dataMw) return '';
  try {
    const source = (JSON.parse(dataMw) as { body?: { extsrc?: unknown } }).body?.extsrc;
    return typeof source === 'string' ? source : '';
  } catch {
    return '';
  }
}
