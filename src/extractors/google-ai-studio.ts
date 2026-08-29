/** Google AI Studio rendered chat-prompt extractor. */

import { registerAiConversationExtractor } from '../core/ai-conversation';

export const googleAiStudioExtractor = registerAiConversationExtractor({
  name: 'Google AI Studio',
  source: 'Google AI Studio',
  assistantLabel: 'Model',
  matches: [
    '*://aistudio.google.com/prompts*',
    '*://aistudio.google.com/app/prompts*',
    '*://aistudio.google.com/apps/*',
  ],
  pathnameRegex: /^(?:\/(?:app\/)?prompts\/[^/]+|\/apps\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:\/|$)/i,
  route(pathname) {
    if (/^\/apps\//i.test(pathname)) return 'app';
    return /\/new(?:_|-)?chat(?:\/|$)/i.test(pathname) ? 'new_chat' : 'saved_prompt';
  },
  titleFallback: 'Google AI Studio Chat Prompt',
  titleSuffix: /\s*[|·-]\s*Google AI Studio\s*$/i,
  contentSource: 'Google AI Studio rendered prompt DOM',
  titleSelectors: [
    '[data-testid="prompt-title"]',
    '[data-test-id="prompt-title"]',
    '[aria-label="Prompt title"]',
    'main h1',
  ],
  turnRootSelectors: [
    '[data-testid="chat-turn"]',
    '[data-test-id="chat-turn"]',
    'ms-chat-turn',
    '.chat-turn-container',
    '[data-message-id]',
  ],
  userSelectors: [
    '[data-testid="user-prompt"]',
    '[data-test-id="user-prompt"]',
    '[data-role="user"]',
    '[data-message-author-role="user"]',
    '[data-turn-role="User" i]',
    'ms-prompt-chunk[type="user"]',
    '.user-prompt-container',
  ],
  assistantSelectors: [
    '[data-testid="model-response"]',
    '[data-test-id="model-response"]',
    '[data-role="model"]',
    '[data-role="assistant"]',
    '[data-message-author-role="assistant"]',
    '[data-turn-role="Model" i]',
    'ms-prompt-chunk[type="model"]',
    '.model-prompt-container',
  ],
  contentSelectors: [
    '[data-testid="message-content"]',
    '[data-test-id="message-content"]',
    'ms-text-chunk',
    '.model-response',
    '.user-prompt',
    '.turn-content',
    '.markdown',
    '.code-block',
  ],
  fallbackSelectors: [
    '[data-testid*="prompt-editor"]',
    'ms-prompt-editor',
    'main',
  ],
  modelSelectors: [
    { selector: '[data-model]', attributes: ['data-model'] },
    { selector: '[data-test-model-id]', attributes: ['data-test-model-id'] },
    { selector: '[data-testid*="model-selector"]' },
    { selector: 'ms-model-selector' },
  ],
  workspaceSelectors: [
    { selector: '[data-testid="prompt-title"]' },
    { selector: '[data-test-id="prompt-title"]' },
  ],
  citationSelectors: [
    '[data-testid*="grounding-source"] a[href]',
    '[data-test-id*="grounding-source"] a[href]',
  ],
  artifactSelectors: [
    '[data-testid*="artifact-content"]',
    '[data-test-id*="artifact-content"]',
    'ms-generated-file',
    '[class*="artifact-content"]',
  ],
  systemInstructionSelectors: [
    'textarea[aria-label*="system instruction" i]',
    '[data-testid*="system-instruction"] [contenteditable="true"]',
    '[data-test-id*="system-instruction"] [contenteditable="true"]',
    'ms-system-instructions [contenteditable="true"]',
  ],
  unrenderedHistorySelectors: [
    '.chat-turn-container.virtual-scroll-container',
    '[data-testid*="virtual-scroll"]',
  ],
  resolveRole(element) {
    const marker = element.matches('[data-turn-role]')
      ? element
      : element.querySelector('[data-turn-role]');
    const role = marker?.getAttribute('data-turn-role')?.toLowerCase();
    if (role === 'user') return 'user';
    if (role === 'model') return 'assistant';
    return null;
  },
  resolveContent(element) {
    if (element.matches('ms-chat-turn')) return element;
    const turn = element.closest('ms-chat-turn');
    if (turn) return turn;
    if (element.matches('ms-text-chunk')) return element;
    return element.querySelector('ms-text-chunk');
  },
});
