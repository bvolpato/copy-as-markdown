/** DeepSeek authenticated and shared conversation extractor. */

import { registerAiConversationExtractor } from '../core/ai-conversation';

export const deepSeekExtractor = registerAiConversationExtractor({
  name: 'DeepSeek',
  source: 'DeepSeek',
  assistantLabel: 'DeepSeek',
  matches: [
    '*://chat.deepseek.com/a/chat*',
    '*://chat.deepseek.com/share*',
    '*://chat.deepseek.com/',
  ],
  pathnameRegex: /^(?:\/$|\/a\/chat(?:\/|$)|\/share(?:\/|$))/i,
  route(pathname) {
    return /^\/share(?:\/|$)/i.test(pathname) ? 'shared' : 'authenticated';
  },
  titleFallback: 'DeepSeek Conversation',
  titleSuffix: /\s*[|·-]\s*DeepSeek\s*$/i,
  contentSource: 'DeepSeek rendered conversation DOM',
  titleSelectors: [
    '[data-testid="conversation-title"]',
    '[class*="conversation-title"]',
    'main h1',
  ],
  turnRootSelectors: [
    '[data-testid="conversation-turn"]',
    '[data-testid="message"]',
    '[data-message-id]',
    '[data-role="user"], [data-role="assistant"]',
    'div.ds-message._63c77b1',
    'div.ds-message',
    'div.dad65929, div._4f9bf79:not(._43c05b5), div._9663006',
  ],
  userSelectors: [
    '[data-testid="user-message"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-author="user"]',
    'div.ds-message.d29f3d7d, div.ds-message._9663006',
    'div.ds-message .d29f3d7d, div.ds-message ._9663006',
    '.fbb737a4',
  ],
  assistantSelectors: [
    '[data-testid="assistant-message"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author="assistant"]',
    'div.ds-message._4f9bf79._43c05b5',
    'div.ds-message ._4f9bf79._43c05b5',
    '.ds-markdown',
  ],
  contentSelectors: [
    '[data-testid="message-content"]',
    '[data-testid*="response-content"]',
    '._4f9bf79._43c05b5',
    '.d29f3d7d',
    '._9663006',
    '.ds-markdown',
    '.fbb737a4',
    '.markdown',
  ],
  fallbackSelectors: [
    '[class*="chat-container"]',
    'main',
    '[role="main"]',
  ],
  modelSelectors: [
    { selector: '[data-model]', attributes: ['data-model'] },
    { selector: '[data-model-name]', attributes: ['data-model-name'] },
    { selector: '[data-testid*="model-selector"]' },
  ],
  citationSelectors: [
    '[class*="search-result"] a[href]',
    '[data-testid*="search-source"] a[href]',
  ],
  unrenderedHistorySelectors: [
    '[class*="history"] [class*="loading"]',
    '[data-testid*="load-previous"]',
  ],
  resolveRole(element) {
    if (
      element.matches('.d29f3d7d, ._9663006')
      || element.querySelector('.d29f3d7d, ._9663006')
    ) return 'user';
    if (
      element.matches('._4f9bf79._43c05b5')
      || element.querySelector('._4f9bf79._43c05b5')
    ) return 'assistant';
    if (element.matches('.ds-markdown') || element.querySelector('.ds-markdown')) return 'assistant';
    if (element.matches('.fbb737a4') || element.querySelector('.fbb737a4')) return 'user';
    return null;
  },
  resolveContent(element, role) {
    return role === 'assistant'
      ? element.querySelector('.ds-markdown, ._4f9bf79._43c05b5')
      : element.querySelector('.fbb737a4, .d29f3d7d, ._9663006');
  },
});
