/**
 * UI injection module.
 * Supports two placement modes:
 *   1. **Anchored** — button injected inline in the host site's UI (feels native)
 *   2. **Floating** — fixed-position button at the bottom-right (default)
 *
 * Anchoring is attempted eagerly and then retried with a MutationObserver
 * for up to 8 seconds so that SPA-rendered elements are caught.
 */

import { AnchorConfig, AnchorStyle } from './types';

const BUTTON_ID = 'cam-copy-btn';
const TOAST_ID = 'cam-toast';
const STYLE_ID = 'cam-styles';
const DISMISS_ID = 'cam-dismiss-btn';
const WRAPPER_ATTR = 'data-cam-anchor-wrapper';

/** Max time (ms) to keep observing for the anchor element. */
const ANCHOR_OBSERVE_TIMEOUT = 8000;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const css = `
    /* ---- Floating wrapper (positions the copy button + dismiss X) ---- */
    .cam-floating-wrapper {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      display: flex;
      align-items: flex-start;
    }

    /* ---- Floating icon button (bottom-right fallback) ---- */
    #${BUTTON_ID}.cam-floating {
      position: relative;
      width: 44px;
      height: 44px;
      padding: 0;
      border: none;
      background: none;
      border-radius: 12px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.15);
      cursor: pointer;
      opacity: 0.8;
      transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    #${BUTTON_ID}.cam-floating:hover {
      transform: scale(1.1);
      opacity: 1;
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    #${BUTTON_ID}.cam-floating:active {
      transform: scale(0.95);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    #${BUTTON_ID}.cam-floating .cam-icon {
      width: 100%;
      height: 100%;
    }

    /* ---- Dismiss (X) button on the floating icon ---- */
    #${DISMISS_ID} {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 18px;
      text-align: center;
      cursor: pointer;
      opacity: 0;
      transform: scale(0.6);
      transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
      z-index: 1;
    }
    .cam-floating-wrapper:hover #${DISMISS_ID} {
      opacity: 1;
      transform: scale(1);
    }
    #${DISMISS_ID}:hover {
      background: rgba(220, 38, 38, 0.9);
    }

    /* ---- Inline: pill (compact gradient pill) ---- */
    #${BUTTON_ID}.cam-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 14px;
      border: none;
      border-radius: 20px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      line-height: 1;
      vertical-align: middle;
    }
    #${BUTTON_ID}.cam-pill:hover {
      background: linear-gradient(135deg, #818cf8, #c084fc);
      box-shadow: 0 2px 12px rgba(99, 102, 241, 0.35);
    }

    /* ---- Inline: tab (Wikipedia-style nav tab) ---- */
    #${BUTTON_ID}.cam-tab {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: none;
      background: none;
      color: #0645ad;
      font-family: inherit;
      font-size: inherit;
      font-weight: normal;
      cursor: pointer;
      line-height: inherit;
      vertical-align: baseline;
      transition: color 0.15s ease;
    }
    #${BUTTON_ID}.cam-tab:hover {
      color: #6366f1;
      text-decoration: underline;
    }

    /* ---- Inline: link (simple text link) ---- */
    #${BUTTON_ID}.cam-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      font-weight: inherit;
      cursor: pointer;
      text-decoration: none;
      opacity: 0.7;
      transition: opacity 0.15s ease;
      line-height: inherit;
      vertical-align: middle;
    }
    #${BUTTON_ID}.cam-link:hover {
      opacity: 1;
      color: #6366f1;
    }

    /* ---- Inline: icon-only ---- */
    #${BUTTON_ID}.cam-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border: none;
      border-radius: 50%;
      background: none;
      color: inherit;
      font-size: 0;
      cursor: pointer;
      transition: all 0.15s ease;
      vertical-align: middle;
      opacity: 0.6;
    }
    #${BUTTON_ID}.cam-icon-btn:hover {
      background: rgba(99, 102, 241, 0.12);
      color: #6366f1;
      opacity: 1;
    }

    /* ---- Shared ---- */
    #${BUTTON_ID} .cam-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    #${BUTTON_ID}.cam-icon-btn .cam-icon {
      width: 20px;
      height: 20px;
    }

    #${BUTTON_ID}.cam-success {
      background: none !important;
      transform: scale(0.95);
    }
    #${BUTTON_ID}.cam-pill.cam-success {
      background: linear-gradient(135deg, #22c55e, #16a34a) !important;
      color: #fff !important;
      opacity: 1 !important;
    }

    /* ---- Toast ---- */
    #${TOAST_ID} {
      position: fixed;
      top: 64px;
      right: 16px;
      z-index: 2147483647;
      padding: 10px 18px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      font-weight: 500;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      max-width: 320px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    #${TOAST_ID}.cam-visible {
      opacity: 1;
      transform: translateY(0);
    }

    @media (max-width: 600px) {
      .cam-floating-wrapper {
        bottom: 24px;
        right: 16px;
      }
      #${BUTTON_ID}.cam-floating {
        padding: 8px 14px;
        font-size: 13px;
        border-radius: 10px;
      }
      #${TOAST_ID} {
        top: auto;
        bottom: 80px;
        right: 16px;
      }
    }
  `;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function getIcon(): string {
  return `<svg class="cam-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="cam-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
    <linearGradient id="cam-fold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#e2e8f0" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="28" fill="url(#cam-bg)"/>
  <path d="M 28 24 C 24 24 20 28 20 32 L 20 80 C 20 84 24 88 28 88 L 84 88 C 88 88 92 84 92 80 L 92 52 L 64 24 Z" fill="#ffffff" opacity="0.95"/>
  <path d="M 92 52 L 68 52 C 65.79 52 64 50.21 64 48 L 64 24 Z" fill="url(#cam-fold)"/>
  <path d="M 30 68 L 30 48 L 37 48 L 42 58 L 47 48 L 54 48 L 54 68 L 48 68 L 48 56 L 43 64 L 41 64 L 36 56 L 36 68 Z" fill="#1e293b"/>
  <rect x="66" y="48" width="14" height="14" rx="2.5" fill="#1e293b"/>
  <rect x="60" y="54" width="14" height="14" rx="2.5" fill="#1e293b" stroke="#ffffff" stroke-width="2.5"/>
</svg>`;
}

function getCheckIcon(): string {
  return `<svg class="cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
}

/** Style class per AnchorStyle value. */
const STYLE_CLASS: Record<AnchorStyle, string> = {
  pill: 'cam-pill',
  tab: 'cam-tab',
  link: 'cam-link',
  icon: 'cam-icon-btn',
};

// ----------------------------------------------------------------
// Anchor placement helpers
// ----------------------------------------------------------------

/**
 * Try to find the anchor element. The anchor `selector` can be a
 * comma-separated list; we try each in order and return the first hit.
 */
function findAnchorTarget(selector: string): Element | null {
  // querySelectorAll already handles comma-separated selectors,
  // but we want the *first match in selector order*, not DOM order.
  const selectors = selector.split(',').map((s) => s.trim());
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid selector — skip silently
    }
  }
  return null;
}

function applyInlineCss(el: HTMLElement, css?: Record<string, string>): void {
  if (!css) return;
  for (const [prop, val] of Object.entries(css)) {
    (el.style as any)[prop] = val;
  }
}

function buildAnchorNode(
  btn: HTMLButtonElement,
  anchor: AnchorConfig,
): HTMLElement {
  applyInlineCss(btn, anchor.css);

  if (!anchor.wrapperTag) return btn;

  const wrapper = document.createElement(anchor.wrapperTag);
  wrapper.setAttribute(WRAPPER_ATTR, 'true');

  if (anchor.wrapperClass) {
    wrapper.className = anchor.wrapperClass;
  }

  applyInlineCss(wrapper, anchor.wrapperCss);
  wrapper.appendChild(btn);
  return wrapper;
}

function clearInjectedUi(): void {
  document.querySelectorAll(`[${WRAPPER_ATTR}]`).forEach((el) => el.remove());
  document.querySelector('.cam-floating-wrapper')?.remove();
  document.getElementById(BUTTON_ID)?.remove();
}

/**
 * Attach the button to the anchor element.
 * Returns true if successful.
 */
function attachToAnchor(
  btn: HTMLButtonElement,
  anchor: AnchorConfig,
): boolean {
  const target = findAnchorTarget(anchor.selector);
  if (!target) return false;

  // Use the extractor's preferred style, defaulting to icon-only
  const styleKey = anchor.style || 'icon';
  btn.className = STYLE_CLASS[styleKey] || 'cam-icon-btn';

  // If a label is provided (or the style is not icon), show text alongside the icon
  const label = anchor.label ?? (styleKey === 'icon' ? '' : 'Copy as Markdown');
  btn.innerHTML = `${getIcon()}${label ? `<span>${label}</span>` : ''}`;

  const insertionNode = buildAnchorNode(btn, anchor);

  const position = anchor.position || 'append';
  switch (position) {
    case 'prepend':
      target.prepend(insertionNode);
      break;
    case 'before':
      target.parentElement?.insertBefore(insertionNode, target);
      break;
    case 'after':
      target.parentElement?.insertBefore(insertionNode, target.nextSibling);
      break;
    case 'append':
    default:
      target.appendChild(insertionNode);
      break;
  }
  return true;
}

/** Dismiss key for sessionStorage, scoped to the current page URL (ignoring hash). */
function getDismissKey(): string {
  return `cam-dismissed:${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function isDismissedForCurrentPage(): boolean {
  try {
    return sessionStorage.getItem(getDismissKey()) === '1';
  } catch {
    return false;
  }
}

function dismissForCurrentPage(): void {
  try {
    sessionStorage.setItem(getDismissKey(), '1');
  } catch { /* storage unavailable — dismiss is visual-only */ }
}

/**
 * Show the button as a floating FAB at the bottom-right,
 * wrapped with a dismiss (X) button.
 */
function showFloating(btn: HTMLButtonElement): void {
  if (isDismissedForCurrentPage()) return;

  btn.className = 'cam-floating';
  btn.innerHTML = getIcon();

  const wrapper = document.createElement('div');
  wrapper.className = 'cam-floating-wrapper';

  const dismiss = document.createElement('button');
  dismiss.id = DISMISS_ID;
  dismiss.title = 'Hide for this page';
  dismiss.setAttribute('aria-label', 'Dismiss Copy as Markdown button');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissForCurrentPage();
    wrapper.remove();
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(dismiss);
  document.body.appendChild(wrapper);
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Show the button on the page.
 *
 * 1. Try to anchor immediately.
 * 2. If the anchor element isn't in the DOM yet, show floating first
 *    and start a MutationObserver. If the anchor appears within
 *    ANCHOR_OBSERVE_TIMEOUT ms, re-attach inline and remove the FAB.
 * 3. If no anchor config is provided, just show floating.
 */
export function showButton(
  onClick: () => Promise<string>,
  anchor?: AnchorConfig | null,
): HTMLButtonElement | null {
  injectStyles();

  clearInjectedUi();

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.title = 'Copy this page as Markdown';
  btn.setAttribute('aria-label', 'Copy this page as Markdown');

  // Wire up click handler
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const md = await onClick();
      if (md) {
        await copyToClipboard(md);
        flashSuccess(btn);
        showToast(`Copied! ${md.length.toLocaleString()} chars of Markdown`);
      }
    } catch (err) {
      console.error('[Copy as Markdown]', err);
      showToast('Error copying — see console');
    }
  });

  // Attempt anchor placement
  if (anchor) {
    if (attachToAnchor(btn, anchor)) {
      console.log('[Copy as Markdown] Anchored inline');
      return btn;
    }

    // Anchor not found yet — show floating immediately, observe for the anchor
    showFloating(btn);
    console.log('[Copy as Markdown] Anchor not found yet, floating while observing…');

    observeForAnchor(btn, anchor);
  } else {
    showFloating(btn);
  }

  return btn;
}

/**
 * Watch the DOM for the anchor element to appear.
 * When found, re-attach the button inline and stop observing.
 */
function observeForAnchor(
  btn: HTMLButtonElement,
  anchor: AnchorConfig,
): void {
  let settled = false;

  const observer = new MutationObserver(() => {
    if (settled) return;
    if (findAnchorTarget(anchor.selector)) {
      settled = true;
      observer.disconnect();

      // Detach from floating position (remove the wrapper if present)
      btn.closest('.cam-floating-wrapper')?.remove();
      btn.remove();
      // Re-create the id so CSS applies cleanly
      btn.className = '';
      btn.removeAttribute('style');

      if (attachToAnchor(btn, anchor)) {
        console.log('[Copy as Markdown] Late-anchored inline');
      } else {
        // Shouldn't happen, but be safe
        showFloating(btn);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Stop observing after timeout
  setTimeout(() => {
    if (!settled) {
      settled = true;
      observer.disconnect();
      console.log('[Copy as Markdown] Anchor not found after timeout, staying floating');
    }
  }, ANCHOR_OBSERVE_TIMEOUT);
}

// ----------------------------------------------------------------
// Clipboard & feedback
// ----------------------------------------------------------------

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

function flashSuccess(btn: HTMLElement): void {
  const original = btn.innerHTML;
  const wasIcon = btn.classList.contains('cam-icon-btn');
  btn.innerHTML = `${getCheckIcon()}${wasIcon ? '' : ' Copied!'}`;
  btn.classList.add('cam-success');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('cam-success');
  }, 2000);
}

export function showToast(message: string): void {
  let toast = document.getElementById(TOAST_ID) as HTMLElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('cam-visible');

  clearTimeout((toast as any)._timer);
  (toast as any)._timer = setTimeout(() => {
    toast!.classList.remove('cam-visible');
  }, 3000);
}
