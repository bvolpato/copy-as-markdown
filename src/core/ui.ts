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
const UI_INSTANCE_ATTR = 'data-cam-instance';
const ACTIVE_INSTANCE_ATTR = 'data-cam-active-instance';

/** Max time (ms) to keep observing for the anchor element. */
const ANCHOR_OBSERVE_TIMEOUT = 8000;
/** Interval (ms) for the anchor watchdog that re-injects if SPA removes the button. */
const ANCHOR_WATCHDOG_INTERVAL = 2000;
let activeAnchorObserver: MutationObserver | null = null;
let activeAnchorTimeout: number | null = null;
let activeWatchdogInterval: number | null = null;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const css = `
    /* ---- Floating wrapper (positions the copy button + dismiss X) ---- */
    .cam-floating-wrapper {
      position: fixed;
      bottom: 96px;
      right: 24px;
      z-index: 999999;
      display: flex;
      align-items: flex-start;
    }

    /* ---- Floating icon button (bottom-right fallback) ---- */
    #${BUTTON_ID}.cam-floating {
      position: relative;
      width: 38px;
      height: 38px;
      padding: 0;
      border: none;
      background: none;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.15);
      cursor: pointer;
      opacity: 0.8;
      transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    #${BUTTON_ID}.cam-floating:hover {
      transform: scale(1.06);
      opacity: 1;
      box-shadow: 0 5px 18px rgba(0,0,0,0.24);
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

    /* ---- Overlay container (near-anchor but outside React tree) ---- */
    .cam-overlay-container {
      position: fixed;
      z-index: 999999;
      pointer-events: auto;
      display: flex;
      align-items: center;
    }

    /* ---- Host-dismiss prompt ---- */
    .cam-dismiss-prompt {
      position: fixed;
      bottom: 140px;
      right: 24px;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.88);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 10px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      display: flex;
      flex-direction: column;
      gap: 6px;
      animation: cam-fade-in 0.2s ease;
    }
    .cam-dismiss-prompt .cam-prompt-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .cam-dismiss-prompt .cam-prompt-btn {
      padding: 3px 10px;
      border: none;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .cam-dismiss-prompt .cam-prompt-yes {
      background: rgba(220, 38, 38, 0.8);
      color: #fff;
    }
    .cam-dismiss-prompt .cam-prompt-yes:hover {
      background: rgba(220, 38, 38, 1);
    }
    .cam-dismiss-prompt .cam-prompt-no {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .cam-dismiss-prompt .cam-prompt-no:hover {
      background: rgba(255, 255, 255, 0.25);
    }
    @keyframes cam-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
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

    @media (max-width: 600px) {
      .cam-floating-wrapper {
        bottom: 92px;
        right: 16px;
      }
      #${BUTTON_ID}.cam-floating {
        border-radius: 9px;
        width: 36px;
        height: 36px;
      }
    }
  `;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

const TOAST_STYLE_ID = 'cam-toast-styles';

function injectToastStyles(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;

  const css = `
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
      #${TOAST_ID} {
        top: auto;
        bottom: 80px;
        right: 16px;
      }
    }
  `;

  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}


/**
 * Create the icon SVG element using DOM APIs (no innerHTML/DOMParser).
 * Trusted Types CSP on sites like Gemini blocks innerHTML sinks.
 */
function createIconElement(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cam-icon');
  svg.setAttribute('viewBox', '0 0 128 128');

  const defs = document.createElementNS(NS, 'defs');

  const grad1 = document.createElementNS(NS, 'linearGradient');
  grad1.id = 'cam-bg';
  grad1.setAttribute('x1', '0%'); grad1.setAttribute('y1', '0%');
  grad1.setAttribute('x2', '100%'); grad1.setAttribute('y2', '100%');
  const s1 = document.createElementNS(NS, 'stop');
  s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#4f46e5');
  const s2 = document.createElementNS(NS, 'stop');
  s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#10b981');
  grad1.appendChild(s1); grad1.appendChild(s2);

  const grad2 = document.createElementNS(NS, 'linearGradient');
  grad2.id = 'cam-fold';
  grad2.setAttribute('x1', '0%'); grad2.setAttribute('y1', '0%');
  grad2.setAttribute('x2', '100%'); grad2.setAttribute('y2', '100%');
  const s3 = document.createElementNS(NS, 'stop');
  s3.setAttribute('offset', '0%'); s3.setAttribute('stop-color', '#ffffff'); s3.setAttribute('stop-opacity', '0.9');
  const s4 = document.createElementNS(NS, 'stop');
  s4.setAttribute('offset', '100%'); s4.setAttribute('stop-color', '#e2e8f0'); s4.setAttribute('stop-opacity', '0.9');
  grad2.appendChild(s3); grad2.appendChild(s4);

  defs.appendChild(grad1); defs.appendChild(grad2);
  svg.appendChild(defs);

  const rect0 = document.createElementNS(NS, 'rect');
  rect0.setAttribute('x', '0'); rect0.setAttribute('y', '0');
  rect0.setAttribute('width', '128'); rect0.setAttribute('height', '128');
  rect0.setAttribute('rx', '28'); rect0.setAttribute('fill', 'url(#cam-bg)');
  svg.appendChild(rect0);

  const paths = [
    { d: 'M 28 24 C 24 24 20 28 20 32 L 20 80 C 20 84 24 88 28 88 L 84 88 C 88 88 92 84 92 80 L 92 52 L 64 24 Z', fill: '#ffffff', opacity: '0.95' },
    { d: 'M 92 52 L 68 52 C 65.79 52 64 50.21 64 48 L 64 24 Z', fill: 'url(#cam-fold)' },
    { d: 'M 30 68 L 30 48 L 37 48 L 42 58 L 47 48 L 54 48 L 54 68 L 48 68 L 48 56 L 43 64 L 41 64 L 36 56 L 36 68 Z', fill: '#1e293b' },
  ];
  for (const p of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', p.fill);
    if (p.opacity) path.setAttribute('opacity', p.opacity);
    svg.appendChild(path);
  }

  const r1 = document.createElementNS(NS, 'rect');
  r1.setAttribute('x', '66'); r1.setAttribute('y', '48');
  r1.setAttribute('width', '14'); r1.setAttribute('height', '14');
  r1.setAttribute('rx', '2.5'); r1.setAttribute('fill', '#1e293b');
  svg.appendChild(r1);

  const r2 = document.createElementNS(NS, 'rect');
  r2.setAttribute('x', '60'); r2.setAttribute('y', '54');
  r2.setAttribute('width', '14'); r2.setAttribute('height', '14');
  r2.setAttribute('rx', '2.5'); r2.setAttribute('fill', '#1e293b');
  r2.setAttribute('stroke', '#ffffff'); r2.setAttribute('stroke-width', '2.5');
  svg.appendChild(r2);

  return svg;
}

function createCheckIconElement(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cam-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M20 6L9 17l-5-5');
  svg.appendChild(path);
  return svg;
}

/**
 * Set button content using pure DOM APIs (CSP-safe, no innerHTML/DOMParser).
 */
function setButtonContent(el: HTMLElement, icon: SVGSVGElement, labelText?: string): void {
  el.textContent = '';
  el.appendChild(icon);
  if (labelText) {
    const span = document.createElement('span');
    span.textContent = labelText;
    el.appendChild(span);
  }
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

function createInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function setActiveInstance(instanceId: string): void {
  document.documentElement.setAttribute(ACTIVE_INSTANCE_ATTR, instanceId);
}

function isActiveInstance(instanceId: string): boolean {
  return document.documentElement.getAttribute(ACTIVE_INSTANCE_ATTR) === instanceId;
}

function markInjected(el: HTMLElement, instanceId: string): void {
  el.setAttribute(UI_INSTANCE_ATTR, instanceId);
}

function cancelAnchorObserver(): void {
  activeAnchorObserver?.disconnect();
  activeAnchorObserver = null;

  if (activeAnchorTimeout !== null) {
    window.clearTimeout(activeAnchorTimeout);
    activeAnchorTimeout = null;
  }
}

function cancelWatchdog(): void {
  if (activeWatchdogInterval !== null) {
    window.clearInterval(activeWatchdogInterval);
    activeWatchdogInterval = null;
  }
}

/**
 * Periodically check if the anchored button is still in the DOM.
 * SPAs (ChatGPT, Claude, Gemini) re-render and destroy injected elements.
 * If removed, try to re-anchor. If anchor target gone, fall back to floating.
 */
function startAnchorWatchdog(
  btn: HTMLButtonElement,
  anchor: AnchorConfig,
  instanceId: string,
  onClick: () => Promise<string>,
): void {
  cancelWatchdog();

  activeWatchdogInterval = window.setInterval(() => {
    if (!isActiveInstance(instanceId)) {
      cancelWatchdog();
      return;
    }

    // Button still in the DOM? Nothing to do.
    if (document.contains(btn)) return;

    // Button was removed by the SPA. Try to re-anchor.
    btn.className = '';
    btn.removeAttribute('style');

    if (attachToAnchor(btn, anchor, instanceId)) {
      console.log('[Copy as Markdown] Re-anchored after SPA re-render');
      return;
    }

    // Anchor target also gone. Show floating fallback.
    console.log('[Copy as Markdown] Anchor target gone, falling back to floating');
    showFloating(btn, instanceId);
  }, ANCHOR_WATCHDOG_INTERVAL);
}

function buildAnchorNode(
  btn: HTMLButtonElement,
  anchor: AnchorConfig,
  instanceId: string,
): HTMLElement {
  applyInlineCss(btn, anchor.css);

  if (!anchor.wrapperTag) return btn;

  const wrapper = document.createElement(anchor.wrapperTag);
  wrapper.setAttribute(WRAPPER_ATTR, 'true');
  markInjected(wrapper, instanceId);

  if (anchor.wrapperClass) {
    wrapper.className = anchor.wrapperClass;
  }

  applyInlineCss(wrapper, anchor.wrapperCss);
  wrapper.appendChild(btn);
  return wrapper;
}

function clearInjectedUi(): void {
  cancelAnchorObserver();
  cancelWatchdog();
  // Clean up overlay reposition intervals
  document.querySelectorAll('.cam-overlay-container').forEach((el) => {
    if ((el as any)._camReposition) clearInterval((el as any)._camReposition);
    el.remove();
  });
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
  instanceId: string,
): boolean {
  if (!isActiveInstance(instanceId)) return false;
  const target = findAnchorTarget(anchor.selector);
  if (!target) return false;

  // Use the extractor's preferred style, defaulting to icon-only
  const styleKey = anchor.style || 'icon';
  btn.className = STYLE_CLASS[styleKey] || 'cam-icon-btn';

  // If a label is provided (or the style is not icon), show text alongside the icon
  const label = anchor.label ?? (styleKey === 'icon' ? '' : 'Copy as Markdown');
  setButtonContent(btn, createIconElement(), label || undefined);

  const position = anchor.position || 'append';

  // Overlay mode: create a fixed container on body positioned near the target,
  // completely outside React's virtual DOM tree.
  if (position === 'overlay') {
    applyInlineCss(btn, anchor.css);

    // Remove any prior overlay
    document.querySelector('.cam-overlay-container')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'cam-overlay-container';
    overlay.setAttribute(WRAPPER_ATTR, 'true');
    markInjected(overlay, instanceId);
    overlay.appendChild(btn);

    const updatePosition = () => {
      const t = findAnchorTarget(anchor.selector);
      if (!t) {
        overlay.style.display = 'none';
        return;
      }
      overlay.style.display = '';
      const rect = t.getBoundingClientRect();
      // Position to the left of the target element
      overlay.style.top = `${rect.top + (rect.height - 36) / 2}px`;
      overlay.style.left = `${rect.left - 44}px`;
    };

    updatePosition();
    document.body.appendChild(overlay);

    // Reposition on scroll/resize and periodically (SPA layout shifts)
    const reposition = () => {
      if (!document.contains(overlay)) return;
      updatePosition();
    };
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });

    // Store cleanup ref on the element so watchdog can update
    (overlay as any)._camReposition = setInterval(reposition, 2000);
    return true;
  }

  const insertionNode = buildAnchorNode(btn, anchor, instanceId);

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

/** Host-level permanent dismiss key for localStorage. */
function getHostDismissKey(): string {
  return `cam-blocked:${window.location.hostname}`;
}

export function isHostDismissed(): boolean {
  try {
    return localStorage.getItem(getHostDismissKey()) === '1';
  } catch {
    return false;
  }
}

function dismissHost(): void {
  try {
    localStorage.setItem(getHostDismissKey(), '1');
  } catch { /* storage unavailable */ }
}

function isDismissedForCurrentPage(): boolean {
  try {
    if (isHostDismissed()) return true;
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
function showFloating(btn: HTMLButtonElement, instanceId: string): void {
  if (!isActiveInstance(instanceId)) return;
  if (isDismissedForCurrentPage()) return;

  btn.className = 'cam-floating';
  setButtonContent(btn, createIconElement());

  const wrapper = document.createElement('div');
  wrapper.className = 'cam-floating-wrapper';
  markInjected(wrapper, instanceId);

  const dismiss = document.createElement('button');
  dismiss.id = DISMISS_ID;
  markInjected(dismiss, instanceId);
  dismiss.title = 'Hide for this page';
  dismiss.setAttribute('aria-label', 'Dismiss Copy as Markdown button');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissForCurrentPage();
    wrapper.remove();

    // Show host-dismiss prompt
    const host = window.location.hostname;
    const prompt = document.createElement('div');
    prompt.className = 'cam-dismiss-prompt';
    const msg = document.createElement('span');
    msg.textContent = `Never show on ${host}?`;
    const actions = document.createElement('div');
    actions.className = 'cam-prompt-actions';
    const yesBtn = document.createElement('button');
    yesBtn.className = 'cam-prompt-btn cam-prompt-yes';
    yesBtn.textContent = 'Yes, hide forever';
    yesBtn.addEventListener('click', () => {
      dismissHost();
      prompt.remove();
    });
    const noBtn = document.createElement('button');
    noBtn.className = 'cam-prompt-btn cam-prompt-no';
    noBtn.textContent = 'No, just this page';
    noBtn.addEventListener('click', () => {
      prompt.remove();
    });
    actions.appendChild(noBtn);
    actions.appendChild(yesBtn);
    prompt.appendChild(msg);
    prompt.appendChild(actions);
    document.body.appendChild(prompt);

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      if (prompt.parentNode) prompt.remove();
    }, 6000);
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
  const instanceId = createInstanceId();
  setActiveInstance(instanceId);

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.title = 'Copy this page as Markdown';
  btn.setAttribute('aria-label', 'Copy this page as Markdown');
  markInjected(btn, instanceId);

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
    if (attachToAnchor(btn, anchor, instanceId)) {
      console.log('[Copy as Markdown] Anchored inline');
      // Start watchdog to re-inject if SPA removes the button
      startAnchorWatchdog(btn, anchor, instanceId, onClick);
      return btn;
    }

    // Anchor not found yet — show floating immediately, observe for the anchor
    showFloating(btn, instanceId);
    console.log('[Copy as Markdown] Anchor not found yet, floating while observing…');

    observeForAnchor(btn, anchor, instanceId, onClick);
  } else {
    showFloating(btn, instanceId);
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
  instanceId: string,
  onClick: () => Promise<string>,
): void {
  let settled = false;

  cancelAnchorObserver();

  const observer = new MutationObserver(() => {
    if (settled) return;
    if (!isActiveInstance(instanceId)) {
      settled = true;
      observer.disconnect();
      return;
    }

    if (findAnchorTarget(anchor.selector)) {
      settled = true;
      observer.disconnect();
      if (activeAnchorObserver === observer) activeAnchorObserver = null;
      if (activeAnchorTimeout !== null) {
        window.clearTimeout(activeAnchorTimeout);
        activeAnchorTimeout = null;
      }

      // Detach from floating position (remove the wrapper if present)
      btn.closest('.cam-floating-wrapper')?.remove();
      btn.remove();
      // Re-create the id so CSS applies cleanly
      btn.className = '';
      btn.removeAttribute('style');

      if (attachToAnchor(btn, anchor, instanceId)) {
        console.log('[Copy as Markdown] Late-anchored inline');
        startAnchorWatchdog(btn, anchor, instanceId, onClick);
      } else {
        // Shouldn't happen, but be safe
        showFloating(btn, instanceId);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  activeAnchorObserver = observer;

  // Stop observing after timeout
  activeAnchorTimeout = window.setTimeout(() => {
    if (!settled) {
      settled = true;
      observer.disconnect();
      if (activeAnchorObserver === observer) activeAnchorObserver = null;
      activeAnchorTimeout = null;
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
  const savedNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  const wasIcon = btn.classList.contains('cam-icon-btn');
  setButtonContent(btn, createCheckIconElement(), wasIcon ? undefined : 'Copied!');
  btn.classList.add('cam-success');
  setTimeout(() => {
    btn.textContent = '';
    savedNodes.forEach(n => btn.appendChild(n));
    btn.classList.remove('cam-success');
  }, 2000);
}

export function showToast(message: string): void {
  injectToastStyles();
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
