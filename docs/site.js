(() => {
  'use strict';

  const { buildPageMarkdown, elementToMarkdown, htmlToMarkdown } = window.CopyAsMarkdownSite;
  const root = document.documentElement;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : ms));
  const count = (value) => value.toLocaleString('en-US');

  /* Clipboard and toast */

  const toast = $('#demo-toast');
  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const focused = document.activeElement;
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      focused?.focus({ preventScroll: true });
      return copied;
    }
  }

  async function copyAndReport(text) {
    const copied = await copyText(text);
    showToast(copied ? `Copied ${count(text.length)} characters of Markdown` : 'Your browser blocked the clipboard');
    return copied;
  }

  /* Markdown highlighting. Text is added as text nodes, so pasted content stays inert. */

  const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(!?\[)([^\]]*)(\]\([^)]*\))/g;

  function span(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  }

  function appendInline(line, text) {
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
      line.append(text.slice(last, match.index));
      if (match[1]) line.append(span('s-code', match[1]));
      else if (match[2]) line.append(span('s-mark', '**'), span('s-strong', match[2].slice(2, -2)), span('s-mark', '**'));
      else line.append(span('s-mark', match[3]), match[4], span('s-mark', match[5]));
      last = match.index + match[0].length;
    }
    line.append(text.slice(last));
  }

  const PREVIEW_LIMIT = 200_000;

  function renderMarkdown(target, text) {
    const markdown = text.slice(0, PREVIEW_LIMIT);
    const fragment = document.createDocumentFragment();
    let fence = '';
    let frontMatter = false;
    markdown.split('\n').forEach((text, index) => {
      const line = document.createElement('span');
      line.className = 'line';
      line.style.setProperty('--i', Math.min(index, 60));
      const opening = /^\s*(`{3,})/.exec(text);
      if (text === '---' && (index === 0 || frontMatter)) {
        frontMatter = index === 0;
        line.append(span('s-dim', text));
      } else if (frontMatter) {
        const colon = text.indexOf(':') + 1;
        line.append(span('s-mark', text.slice(0, colon)), text.slice(colon));
      } else if (opening && (!fence || opening[1].length >= fence.length)) {
        fence = fence ? '' : opening[1];
        line.append(span('s-mark', text));
      } else if (fence) {
        line.append(span('s-code', text));
      } else {
        const heading = /^(#{1,6} )(.*)$/.exec(text);
        const marker = /^(\s*(?:[-*+]|\d+\.|>) )(.*)$/.exec(text);
        if (heading) line.append(span('s-mark', heading[1]), span('s-head', heading[2]));
        else if (/^\s*\|/.test(text)) {
          text.split(/(\|)/).forEach((part) => {
            if (part === '|') line.append(span('s-mark', part));
            else appendInline(line, part);
          });
        } else if (marker) {
          line.append(span('s-mark', marker[1]));
          appendInline(line, marker[2]);
        } else appendInline(line, text);
      }
      line.append('\n');
      fragment.append(line);
    });
    if (text.length > PREVIEW_LIMIT) {
      fragment.append(span('line s-dim', `The preview ends here. Copy gives all ${count(text.length)} characters.`));
    }
    target.replaceChildren(fragment);
  }

  function describe(text) {
    const matches = (pattern) => (text.match(pattern) || []).length;
    return {
      characters: text.length,
      headings: matches(/^#{1,6} /gm),
      links: matches(/\]\(https?:/g),
      tables: matches(/^\| ?-{3}/gm),
      'code blocks': Math.floor(matches(/^```/gm) / 2),
    };
  }

  function renderStats(target, text, source) {
    const parts = Object.entries(describe(text))
      .filter(([name, value]) => name === 'characters' || value > 0)
      .map(([name, value]) => [count(value), value === 1 ? name.replace(/s$/, '') : name]);
    if (!/^#{1,6} /m.test(text)) parts.push(['0', 'headings']);
    target.replaceChildren(...parts.map(([value, name]) => {
      const item = document.createElement('span');
      const number = document.createElement('b');
      number.textContent = value;
      item.append(number, ` ${name}`);
      return item;
    }));
    if (source) target.append(span('', `from ${count(source)} characters of HTML`));
  }

  /* Demo */

  const demo = $('#demo');
  const page = $('#demo-page');
  const out = $('#demo-out');
  const stats = $('#demo-stats');
  const run = $('#run-demo');
  const runLabel = $('span', run);
  const pasteBox = $('#paste-box');
  const state = { sample: 'article', output: 'md', copied: false, run: 0, pasted: '', pastedPlain: '', pastedSource: 0 };

  const mock = () => $(`[data-mock="${state.sample}"]`);

  function sampleMarkdown() {
    if (state.sample === 'paste') return state.pasted;
    const source = mock();
    const clone = source.cloneNode(true);
    clone.removeAttribute('hidden');
    $$('[data-noise]', clone).forEach((element) => element.remove());
    // The sample sits inside this page, so its headings start at level 3.
    $$('h3, h4', clone).forEach((heading) => {
      const replacement = document.createElement(heading.matches('h3') ? 'h1' : 'h2');
      replacement.append(...heading.childNodes);
      heading.replaceWith(replacement);
    });
    return buildPageMarkdown({ title: source.dataset.title, url: source.dataset.url }, elementToMarkdown(clone));
  }

  function samplePlain() {
    if (state.sample === 'paste') return state.pastedPlain;
    const clone = mock().cloneNode(true);
    clone.removeAttribute('hidden');
    clone.style.cssText = 'position:absolute;left:-9999px;width:560px';
    document.body.append(clone);
    const text = clone.innerText.trim();
    clone.remove();
    return text;
  }

  function showPlaceholder() {
    const text = state.sample === 'paste' ? 'Your Markdown appears here.' : 'Press Copy as Markdown.';
    out.replaceChildren(span('placeholder', text));
    stats.replaceChildren();
  }

  function showOutput({ animate = false } = {}) {
    if (!state.copied) return showPlaceholder();
    const text = state.output === 'md' ? sampleMarkdown() : samplePlain();
    out.classList.toggle('lines-in', animate);
    if (state.output === 'md') renderMarkdown(out, text);
    else out.replaceChildren(document.createTextNode(text));
    out.parentElement.scrollTop = 0;
    renderStats(stats, text, state.output === 'md' && state.sample === 'paste' ? state.pastedSource : 0);
  }

  function resetSample() {
    state.run += 1;
    state.copied = state.sample === 'paste' && Boolean(state.pasted);
    page.classList.remove('scan', 'clean');
    runLabel.textContent = 'Copy as Markdown';
  }

  async function runDemo({ toClipboard }) {
    if (state.sample === 'paste') {
      if (!state.pasted) {
        pasteBox.focus();
        return showToast('Paste something first');
      }
      return copyAndReport(state.pasted);
    }
    resetSample();
    const current = state.run;
    selectTab('[data-out]', 'out', state.output = 'md');
    showPlaceholder();
    if (toClipboard) copyAndReport(sampleMarkdown());
    page.scrollTop = 0;
    page.classList.add('scan');
    await wait(650);
    if (current !== state.run) return;
    page.classList.add('clean');
    await wait(260);
    if (current !== state.run) return;
    state.copied = true;
    showOutput({ animate: true });
    runLabel.textContent = 'Copy again';
  }

  function selectTab(selector, key, value) {
    $$(selector, demo).forEach((tab) => {
      const selected = tab.dataset[key] === value;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  }

  function enableArrowKeys(tablist) {
    tablist.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const tabs = $$('[role="tab"]', tablist);
      const next = tabs[(tabs.indexOf(document.activeElement) + step + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  }
  $$('[role="tablist"]').forEach(enableArrowKeys);

  $$('[data-sample]', demo).forEach((tab) => tab.addEventListener('click', () => {
    if (state.sample === tab.dataset.sample) return;
    state.sample = tab.dataset.sample;
    selectTab('[data-sample]', 'sample', state.sample);
    $$('[data-mock]').forEach((element) => { element.hidden = element.dataset.mock !== state.sample; });
    $('#demo-url').textContent = mock().dataset.url?.replace('https://', '') || 'your clipboard';
    selectTab('[data-out]', 'out', state.output = 'md');
    page.scrollTop = 0;
    resetSample();
    if (state.sample === 'paste') showOutput();
    else runDemo({ toClipboard: false });
  }));

  $$('[data-out]', demo).forEach((tab) => tab.addEventListener('click', () => {
    state.output = tab.dataset.out;
    if (state.sample !== 'paste') state.copied = true;
    selectTab('[data-out]', 'out', state.output);
    showOutput();
  }));

  run.addEventListener('click', () => runDemo({ toClipboard: true }));

  function convertPasted(html, plain) {
    state.pasted = html ? htmlToMarkdown(html) : plain;
    state.pastedPlain = plain;
    state.pastedSource = html.length;
    state.copied = Boolean(state.pasted);
    selectTab('[data-out]', 'out', state.output = 'md');
    showOutput();
  }

  pasteBox.addEventListener('paste', (event) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const plain = event.clipboardData.getData('text/plain');
    pasteBox.value = plain;
    convertPasted(html, plain);
  });
  pasteBox.addEventListener('input', () => convertPasted('', pasteBox.value));

  selectTab('[data-sample]', 'sample', state.sample);
  selectTab('[data-out]', 'out', state.output);
  showPlaceholder();
  setTimeout(() => {
    if (!state.copied && state.run === 0) runDemo({ toClipboard: false });
  }, reducedMotion.matches ? 0 : 900);

  /* This page as Markdown */

  const main = $('#main');
  const pageUrl = () => `${location.origin === 'null' ? '' : location.origin}${location.pathname}`;

  function pageMarkdown() {
    const clone = main.cloneNode(true);
    $$('#measured-rows th', clone).forEach((name) => {
      const link = $('a', name);
      link.textContent = $('.pick', name).textContent;
      name.replaceChildren(link);
    });
    $$('[data-md-skip]', clone).forEach((element) => element.remove());
    return buildPageMarkdown({ title: 'Copy as Markdown', url: pageUrl() }, elementToMarkdown(clone));
  }

  function renderMarkdownView() {
    const markdown = pageMarkdown();
    renderMarkdown($('#markdown-out'), markdown);
    $('#markdown-stats').textContent = `${count(markdown.length)} characters, from ${count(main.outerHTML.length)} characters of HTML`;
  }

  let switching = 0;
  async function setView(view, { animate }) {
    const token = ++switching;
    const markdown = view === 'markdown';
    $$('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    if (markdown === root.classList.contains('view-markdown')) return root.classList.remove('morph');
    if (animate) {
      if (!markdown) root.classList.replace('view-markdown', 'morph');
      else root.classList.add('morph');
      await wait(markdown ? 380 : 30);
      if (token !== switching) return;
    }
    if (markdown) renderMarkdownView();
    root.classList.toggle('view-markdown', markdown);
    root.classList.remove('morph');
    if (animate) scrollTo({ top: 0, behavior: 'instant' });
    if (animate && markdown) $('#markdown-title').focus({ preventScroll: true });
  }

  $$('[data-view]').forEach((button) => button.addEventListener('click', () => {
    const { view } = button.dataset;
    history.replaceState(null, '', view === 'markdown' ? '#markdown' : location.pathname + location.search);
    setView(view, { animate: true });
  }));
  addEventListener('hashchange', () => setView(location.hash === '#markdown' ? 'markdown' : 'page', { animate: false }));
  $('.logo').addEventListener('click', () => setView('page', { animate: false }));
  $('.skip-link').addEventListener('click', (event) => {
    if (!root.classList.contains('view-markdown')) return;
    event.preventDefault();
    $('#markdown-title').focus();
  });
  $$('.site-nav a[href^="#"]').forEach((link) => link.addEventListener('click', () => setView('page', { animate: false })));

  $('#copy-view').addEventListener('click', () => copyAndReport(pageMarkdown()));

  const copyButton = $('#copy_as_markdown_btn');
  copyButton.addEventListener('click', async () => {
    const selection = getSelection();
    let markdown = '';
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      const holder = document.createElement('div');
      holder.append(selection.getRangeAt(0).cloneContents());
      markdown = buildPageMarkdown({ title: 'Copy as Markdown', url: pageUrl() }, elementToMarkdown(holder));
    }
    if (await copyAndReport(markdown || pageMarkdown())) {
      copyButton.classList.add('success');
      setTimeout(() => copyButton.classList.remove('success'), 1800);
    }
  });

  /* Measured pages. One square stands for 1,000 characters of HTML. */

  const rows = $$('#measured-rows tr');
  const cells = $('#cells');

  function showMeasurement(row) {
    const html = Math.round(row.dataset.html / 1000);
    const kept = Math.round(row.dataset.md / 1000);
    rows.forEach((other) => {
      other.classList.toggle('on', other === row);
      $('.pick', other).setAttribute('aria-pressed', String(other === row));
    });
    while (cells.childElementCount > html) cells.lastElementChild.remove();
    while (cells.childElementCount < html) cells.append(document.createElement('i'));
    [...cells.children].forEach((cell, index) => cell.classList.toggle('k', index < kept));
    cells.setAttribute('aria-label', `${kept} of ${html} squares are Markdown`);
    $('#cells-caption').textContent = `${$('.pick', row).textContent}: one square is 1,000 characters.`;
  }

  rows.forEach((row) => {
    const name = $('th', row);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pick';
    pick.textContent = name.textContent;
    const link = $('a', name);
    link.textContent = 'open';
    link.classList.add('open-page');
    link.setAttribute('aria-label', `Open the ${pick.textContent}`);
    link.addEventListener('click', (event) => event.stopPropagation());
    name.prepend(pick, ' ');
    row.addEventListener('click', () => showMeasurement(row));
  });
  if (rows.length) showMeasurement(rows[0]);

  /* Supported sites */

  const list = $('#site-list');
  const filter = $('#site-filter');
  const details = $('#site-details');
  const result = $('#site-result');
  const items = $$('[data-extractor]', list);

  function applyFilter() {
    const words = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const item of items) {
      const group = item.closest('.site-group');
      const text = `${item.textContent} ${item.dataset.extractor} ${$('h3', group).textContent}`.toLowerCase();
      item.hidden = !words.every((word) => text.includes(word));
      if (!item.hidden) visible += 1;
    }
    $$('.site-group', list).forEach((group) => {
      group.hidden = !$$('[data-extractor]', group).some((item) => !item.hidden);
    });
    list.classList.toggle('details', details.checked || (words.length > 0 && visible <= 30));
    if (!words.length) result.textContent = '';
    else if (visible) result.textContent = `${visible} ${visible === 1 ? 'match' : 'matches'}`;
    else result.textContent = 'No dedicated extractor. The general one handles it.';
  }

  filter.addEventListener('input', applyFilter);
  details.addEventListener('change', applyFilter);
  applyFilter();

  // Every section above must be ready before the page is converted.
  if (location.hash === '#markdown') setView('markdown', { animate: false });
})();
