const extensionAction = chrome.action || chrome.browserAction;

if (extensionAction) {
  extensionAction.onClicked.addListener((tab) => {
    if (tab && tab.id) {
      const tabId = tab.id;
      chrome.tabs.sendMessage(tabId, { action: 'copy-as-markdown' }).catch(() => {
        // Not injected yet, or on a restricted page. Attempt to inject.
        const injectPromise = typeof chrome.scripting !== 'undefined'
          ? chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
          : new Promise((resolve, reject) => {
              chrome.tabs.executeScript(tabId, { file: 'content.js' }, (result) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result);
              });
            });

        injectPromise
          .then(() => {
            // After injection, send the message to trigger the copy
            return chrome.tabs.sendMessage(tabId, { action: 'copy-as-markdown' });
          })
          .catch((err) => {
            console.error('[Copy as Markdown] Failed to inject/execute:', err);
          });
      });
    }
  });
}
