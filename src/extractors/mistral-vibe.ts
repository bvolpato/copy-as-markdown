/** Mistral Vibe, formerly Le Chat, conversation and work-task extractor. */

import { registerAiConversationExtractor } from '../core/ai-conversation';

export const mistralVibeExtractor = registerAiConversationExtractor({
  name: 'Mistral Vibe',
  source: 'Mistral Vibe',
  assistantLabel: 'Mistral',
  matches: [
    '*://chat.mistral.ai/chat/*',
  ],
  pathnameRegex: /^\/chat\/[^/]+(?:\/|$)/i,
  route() {
    return 'chat';
  },
  titleFallback: 'Mistral Vibe Conversation',
  titleSuffix: /\s*[|·-]\s*(?:Mistral\s+)?(?:Vibe|Le Chat)\s*$/i,
  contentSource: 'Mistral Vibe rendered conversation DOM',
  titleSelectors: [
    '[data-testid="conversation-title"]',
    '[data-testid*="task-title"]',
    'main h1',
  ],
  turnRootSelectors: [
    '[data-message-author-role][data-message-id]',
    '[data-testid="message"]',
    '[data-testid="conversation-turn"]',
    '[data-message-id]',
    '[data-message-role]',
    '[class*="message-row"]',
    '[role="article"]',
  ],
  userSelectors: [
    '[data-testid="user-message"]',
    '[data-testid*="user-message"]',
    '[data-message-author-role="user"]',
    '[data-message-role="user"]',
    '[data-role="user"]',
    '[data-author="user"]',
  ],
  assistantSelectors: [
    '[data-testid="assistant-message"]',
    '[data-testid*="assistant-message"]',
    '[data-message-author-role="assistant"]',
    '[data-message-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author="assistant"]',
  ],
  contentSelectors: [
    '[data-message-part-type="answer"][data-testid="text-message-part"]',
    '[data-testid="message-content"]',
    '[data-testid*="message-content"]',
    '[data-testid*="markdown"]',
    '.markdown',
    '.prose',
  ],
  fallbackSelectors: [
    '[data-testid="conversation-layout"]',
    '[data-testid*="conversation"]',
    '[data-testid*="task-thread"]',
    'main',
  ],
  modelSelectors: [
    { selector: '[data-model]', attributes: ['data-model'] },
    { selector: '[data-model-name]', attributes: ['data-model-name'] },
    { selector: '[data-testid*="model-selector"]' },
  ],
  workspaceSelectors: [
    { selector: '[data-testid="workspace-name"]' },
    { selector: '[data-testid*="project-name"]' },
  ],
  citationSelectors: [
    '[data-testid*="web-search-source"] a[href]',
    '[data-testid*="reference"] a[href]',
  ],
  artifactSelectors: [
    '[data-testid*="canvas-content"]',
    '[data-testid*="artifact-content"]',
    '[data-canvas-id]',
    '[class*="canvas-content"]',
  ],
  unrenderedHistorySelectors: [
    '[data-testid*="load-previous"]',
    '[data-testid*="history-loader"]',
  ],
});
