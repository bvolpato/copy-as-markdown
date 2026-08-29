/** Microsoft Copilot consumer conversation extractor. */

import { registerAiConversationExtractor } from '../core/ai-conversation';

export const microsoftCopilotExtractor = registerAiConversationExtractor({
  name: 'Microsoft Copilot',
  source: 'Microsoft Copilot',
  assistantLabel: 'Copilot',
  matches: [
    '*://copilot.com/*',
    '*://www.copilot.com/*',
    '*://copilot.microsoft.com/*',
  ],
  pathnameRegex: /^(?:\/$|\/(?:chats?|shares?|conversations?)(?:\/|$)|\/projects\/[^/]+\/chats?(?:\/|$))/i,
  route(pathname) {
    if (/^\/shares?\//i.test(pathname)) return 'shared';
    if (/^\/projects\//i.test(pathname)) return 'project';
    if (/^\/conversations?\//i.test(pathname)) return 'group';
    return 'consumer_chat';
  },
  titleFallback: 'Microsoft Copilot Conversation',
  titleSuffix: /\s*[|·-]\s*(?:Microsoft\s+)?Copilot\s*$/i,
  contentSource: 'Microsoft Copilot rendered conversation DOM',
  titleSelectors: [
    '[data-testid="conversation-title"]',
    '[data-testid*="chat-title"]',
    'main h1',
  ],
  turnRootSelectors: [
    '[data-testid="conversation-turn"]',
    '[data-testid="message"]',
    '[data-message-id]',
    'cib-message',
    'cib-message-group[source="user"], cib-message-group[source="bot"]',
    '[data-content][data-author="user"], [data-content][data-author="bot"]',
    '[class*="message-group"]',
  ],
  userSelectors: [
    '[data-testid="user-message"]',
    '[data-testid*="user-message"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-author="user"]',
    '[data-content="user-message"]',
    'cib-message[type="user"]',
    'cib-message-group[source="user"] .content',
    'cib-message-group[source="user"]',
    '[data-content][data-author="user"]',
  ],
  assistantSelectors: [
    '[data-testid="assistant-message"]',
    '[data-testid*="copilot-message"]',
    '[data-testid*="bot-message"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author="assistant"]',
    '[data-content="assistant-message"]',
    'cib-message[type="bot"]',
    'cib-message-group[source="bot"] .content',
    'cib-message-group[source="bot"]',
    '[data-content][data-author="bot"]',
  ],
  contentSelectors: [
    '[data-testid="message-content"]',
    '[data-testid*="response-content"]',
    '[data-content="message-content"]',
    '.content',
    '.ac-textBlock',
    '.markdown',
    '.prose',
  ],
  fallbackSelectors: [
    '[data-testid="share-page"] [data-content="conversation"]',
    '[data-content="conversation"]',
    '[data-testid*="conversation"]',
    'main',
    '[role="main"]',
  ],
  modelSelectors: [
    { selector: '[data-model]', attributes: ['data-model'] },
    { selector: '[data-model-name]', attributes: ['data-model-name'] },
    { selector: '[data-testid*="model-selector"]' },
  ],
  workspaceSelectors: [
    { selector: '[data-testid="project-title"]' },
    { selector: '[data-testid="workspace-name"]' },
  ],
  citationSelectors: [
    'a[aria-label*="citation" i][href]',
    '[data-testid*="reference"] a[href]',
  ],
  artifactSelectors: [
    '[data-testid="copilot-page"]',
    '[data-testid*="artifact-content"]',
    '[data-copilot-page]',
    '[data-testid*="canvas-content"]',
  ],
  unrenderedHistorySelectors: [
    '[data-testid*="history-loader"]',
    '[aria-label*="load earlier" i]',
  ],
});
