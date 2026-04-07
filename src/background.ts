const extensionAction = chrome.action || chrome.browserAction;

if (extensionAction) {
  extensionAction.onClicked.addListener((tab) => {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'copy-as-markdown' }).catch(() => {
        // If content script is not injected (e.g., chrome:// URLs)
      });
    }
  });
}
