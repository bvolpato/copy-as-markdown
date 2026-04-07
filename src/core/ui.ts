/**
 * UI injection module.
 * Supports two placement modes:
 *   1. **Anchored** — button injected inline in the host site's UI (feels native)
 *   2. **Floating** — fixed-position button at the top-right (fallback)
 *
 * Anchoring is attempted eagerly and then retried with a MutationObserver
 * for up to 8 seconds so that SPA-rendered elements are caught.
 */

import { AnchorConfig, AnchorStyle } from './types';

const BUTTON_ID = 'cam-copy-btn';
const TOAST_ID = 'cam-toast';
const STYLE_ID = 'cam-styles';

/** Max time (ms) to keep observing for the anchor element. */
const ANCHOR_OBSERVE_TIMEOUT = 8000;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const css = `
    /* ---- Floating icon button (top-right fallback) ---- */
    #${BUTTON_ID}.cam-floating {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      border: none;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(99, 102, 241, 0.35);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      -webkit-user-select: none;
      line-height: 0;
      font-size: 0;
    }
    #${BUTTON_ID}.cam-floating:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5), 0 0 0 3px rgba(139, 92, 246, 0.15);
      background: linear-gradient(135deg, #818cf8, #a78bfa, #c084fc);
    }
    #${BUTTON_ID}.cam-floating:active {
      transform: scale(0.95);
      box-shadow: 0 1px 6px rgba(99, 102, 241, 0.3);
    }
    #${BUTTON_ID}.cam-floating .cam-icon {
      width: 20px;
      height: 20px;
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
      #${BUTTON_ID}.cam-floating {
        top: 12px;
        right: 12px;
        padding: 8px 14px;
        font-size: 13px;
        border-radius: 10px;
      }
      #${TOAST_ID} {
        top: 56px;
        right: 12px;
      }
    }
  `;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function getIcon(): string {
  return `<svg class="cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="4" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="M9 14l2 2 4-4"/>
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

  if (anchor.css) {
    for (const [prop, val] of Object.entries(anchor.css)) {
      (btn.style as any)[prop] = val;
    }
  }

  const position = anchor.position || 'append';
  switch (position) {
    case 'prepend':
      target.prepend(btn);
      break;
    case 'before':
      target.parentElement?.insertBefore(btn, target);
      break;
    case 'after':
      target.parentElement?.insertBefore(btn, target.nextSibling);
      break;
    case 'append':
    default:
      target.appendChild(btn);
      break;
  }
  return true;
}

/**
 * Show the button as a floating FAB at the top-right.
 */
function showFloating(btn: HTMLButtonElement): void {
  btn.className = 'cam-floating';
  btn.innerHTML = getIcon();
  document.body.appendChild(btn);
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

  // Remove any existing button
  document.getElementById(BUTTON_ID)?.remove();

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

      // Detach from floating position
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
