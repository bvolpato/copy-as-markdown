/** Gemini Notebook and legacy NotebookLM notebook conversation extractor. */

import { registerAiConversationExtractor } from '../core/ai-conversation';

export const geminiNotebookExtractor = registerAiConversationExtractor({
  name: 'Gemini Notebook',
  source: 'Gemini Notebook',
  assistantLabel: 'Gemini Notebook',
  matches: [
    '*://notebook.google.com/notebook/*',
    '*://notebooklm.google.com/notebook/*',
    '*://notebooklm.cloud.google.com/notebook/*',
  ],
  pathnameRegex: /^\/notebook\/[^/]+(?:\/|$)/i,
  route() {
    return window.location.hostname === 'notebook.google.com'
      ? 'gemini_notebook'
      : 'legacy_notebooklm';
  },
  titleFallback: 'Gemini Notebook Conversation',
  titleSuffix: /\s*[|·-]\s*(?:Gemini Notebook|NotebookLM)\s*$/i,
  contentSource: 'Gemini Notebook rendered chat DOM',
  titleSelectors: [
    '[data-testid="notebook-title"]',
    '[data-testid*="notebook-title"]',
    'header h1',
    'main h1',
  ],
  turnRootSelectors: [
    '.from-user-container, .to-user-container',
    '[data-testid="chat-message"]',
    '[data-testid*="chat-message"]',
    '.chat-message',
    '[data-message-id]',
    '[role="listitem"]',
  ],
  userSelectors: [
    '[data-testid="user-message"]',
    '[data-testid*="user-query"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '.chat-message.query',
    '.chat-message.user',
    '.user-query',
    '.from-user-container',
  ],
  assistantSelectors: [
    '[data-testid="assistant-message"]',
    '[data-testid*="assistant-response"]',
    '[data-testid*="chat-response"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.chat-message.response',
    '.chat-message.answer',
    '.chat-message.assistant',
    '.to-user-container',
  ],
  contentSelectors: [
    '[data-testid="message-content"]',
    '[data-testid*="response-content"]',
    '.message-content',
    '.response-content',
    '.query-text',
    '.markdown',
  ],
  fallbackSelectors: [
    'chat-panel .chat-panel-content',
    '[role="log"]',
    '[data-testid*="chat-panel"]',
    '[class*="chat-panel"]',
    'main',
  ],
  workspaceSelectors: [
    { selector: '[data-testid="notebook-title"]' },
    { selector: '[data-testid*="notebook-title"]' },
  ],
  citationSelectors: [
    'a[aria-label*="source" i][href]',
    '[data-testid*="source-citation"] a[href]',
    '[class*="source-chip"] a[href]',
  ],
  attachmentSelectors: [
    '[data-testid*="source-file"] a[href]',
    '[class*="source-file"] a[href]',
  ],
  sourceCardSelectors: [
    '.single-source-container',
  ],
  artifactSelectors: [
    '.artifact-library-container .artifact-item-button',
    '.artifact-viewer-content',
    '[data-testid*="artifact-content"]',
    '[data-artifact-id]',
    '[class*="studio-output"]',
    '[class*="artifact-content"]',
  ],
  unrenderedHistorySelectors: [
    '[data-testid*="load-older-messages"]',
    '[class*="chat-history"] [class*="virtual"]',
  ],
  resolveRole(element) {
    if (element.matches('.from-user-container') || element.querySelector('.from-user-container')) {
      return 'user';
    }
    if (element.matches('.to-user-container') || element.querySelector('.to-user-container')) {
      return 'assistant';
    }
    return null;
  },
});
