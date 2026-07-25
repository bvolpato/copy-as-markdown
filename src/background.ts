type CopyResponse = {
  success: boolean;
  error?: string;
};

type ExtensionAction = {
  onClicked: {
    addListener(callback: (tab: chrome.tabs.Tab) => void): void;
  };
  setBadgeText(details: { tabId: number; text: string }): void | Promise<void>;
  setBadgeBackgroundColor(details: { tabId: number; color: string }): void | Promise<void>;
  setTitle(details: { tabId: number; title: string }): void | Promise<void>;
};

class MessageDeliveryError extends Error {}
class InjectionError extends Error {}

const extensionAction = (chrome.action || chrome.browserAction) as ExtensionAction | undefined;
const feedbackTimers = new Map<number, ReturnType<typeof setTimeout>>();

function callAction<T>(
  method: (details: T) => void | Promise<void>,
  details: T,
): void {
  try {
    const result = method.call(extensionAction, details);
    if (result && typeof result.catch === 'function') {
      result.catch(() => undefined);
    }
  } catch {
    // Toolbar feedback must never interrupt the copy operation.
  }
}

function setFeedback(
  tabId: number,
  text: string,
  color: string,
  title: string,
  clearAfterMs?: number,
): void {
  if (!extensionAction) return;

  const existingTimer = feedbackTimers.get(tabId);
  if (existingTimer) clearTimeout(existingTimer);
  feedbackTimers.delete(tabId);

  callAction(extensionAction.setBadgeText, { tabId, text });
  callAction(extensionAction.setBadgeBackgroundColor, { tabId, color });
  callAction(extensionAction.setTitle, { tabId, title });

  if (clearAfterMs) {
    feedbackTimers.set(tabId, setTimeout(() => {
      callAction(extensionAction.setBadgeText, { tabId, text: '' });
      callAction(extensionAction.setTitle, { tabId, title: 'Copy as Markdown' });
      feedbackTimers.delete(tabId);
    }, clearAfterMs));
  }
}

function sendCopyRequest(tabId: number): Promise<CopyResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'copy-as-markdown' }, (response: CopyResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new MessageDeliveryError(lastError.message));
        return;
      }

      if (!response) {
        reject(new MessageDeliveryError('Content script did not respond'));
        return;
      }

      resolve(response);
    });
  });
}

function injectContentScript(tabId: number): Promise<void> {
  if (typeof chrome.scripting !== 'undefined') {
    return chrome.scripting
      .executeScript({ target: { tabId }, files: ['content.js'] })
      .then(() => undefined)
      .catch((error) => {
        throw new InjectionError(error instanceof Error ? error.message : String(error));
      });
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, { file: 'content.js' }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new InjectionError(lastError.message));
      } else {
        resolve();
      }
    });
  });
}

async function copyFromTab(tabId: number): Promise<void> {
  setFeedback(tabId, '…', '#2563eb', 'Copy as Markdown: copying');

  try {
    let response: CopyResponse;
    try {
      response = await sendCopyRequest(tabId);
    } catch (error) {
      if (!(error instanceof MessageDeliveryError)) throw error;
      await injectContentScript(tabId);
      response = await sendCopyRequest(tabId);
    }

    if (!response.success) {
      throw new Error(response.error || 'Copy failed');
    }

    setFeedback(tabId, '✓', '#16a34a', 'Copy as Markdown: copied', 2500);
  } catch (error) {
    const unavailable = error instanceof InjectionError || error instanceof MessageDeliveryError;
    const title = unavailable
      ? 'Copy as Markdown: unavailable on this page'
      : 'Copy as Markdown: copy failed';
    setFeedback(tabId, '!', '#dc2626', title, 4000);
    console.error('[Copy as Markdown] Copy failed:', error);
  }
}

if (extensionAction) {
  extensionAction.onClicked.addListener((tab) => {
    if (tab.id !== undefined) {
      void copyFromTab(tab.id);
    }
  });
}
