/**
 * Replace rendered math in a detached clone with its TeX source.
 * These renderers hide the source, draw it as SVG, or repeat it. The converter reads KaTeX and LaTeXML itself.
 */
export function restoreMathSource(root: Element): void {
  const replace = (target: Element, tex: string, isBlock: boolean): void => {
    const source = cleanTex(tex);
    if (!source) return;
    const replacement = target.ownerDocument.createElement(isBlock ? 'div' : 'span');
    replacement.textContent = isBlock ? `$$${source}$$` : `$${source}$`;
    target.replaceWith(replacement);
  };

  const wikiMath = Array.from(root.querySelectorAll(
    '.mwe-math-element, .mwe-math-fallback-image-inline, .mwe-math-fallback-image-display',
  )).filter((element) => !element.parentElement?.closest('.mwe-math-element'));
  for (const element of wikiMath) {
    const isBlock = element.matches('.mwe-math-element-block, .mwe-math-fallback-image-display, [display="block"]')
      || Boolean(element.querySelector('.mwe-math-mathml-display, .mwe-math-fallback-image-display'));
    replace(element.closest('.mwe-math-mathml-a11y') || element, wikiTex(element, root), isBlock);
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
    while (script.previousElementSibling?.matches('[class^="MathJax"], [class^="MJX"]')) {
      script.previousElementSibling.remove();
    }
    replace(script, script.textContent || '', /mode\s*=\s*display/.test(script.getAttribute('type') || ''));
  });

  root.querySelectorAll('mjx-container').forEach((element) => {
    const math = element.querySelector('mjx-assistive-mml math');
    if (math) replace(element, mathmlToTex(math), element.getAttribute('display') === 'true');
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
    || mathmlToTex(element);
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

function mathmlToTex(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').trim();
  if (!(node instanceof Element)) return '';
  const children = Array.from(node.childNodes, mathmlToTex).filter(Boolean);
  const [first = '', second = '', third = ''] = children;
  switch (node.localName) {
    case 'msub':
    case 'munder': return `${first}_{${second}}`;
    case 'msup':
    case 'mover': return `${first}^{${second}}`;
    case 'msubsup':
    case 'munderover': return `${first}_{${second}}^{${third}}`;
    case 'mfrac': return `\\frac{${first}}{${second}}`;
    case 'msqrt': return `\\sqrt{${children.join('')}}`;
    case 'mroot': return `\\sqrt[${second}]{${first}}`;
    case 'mtr': return children.join(' & ');
    case 'mtable': return children.join(' \\\\ ');
    case 'annotation':
    case 'annotation-xml': return '';
    default: return children.join('');
  }
}
