import { getAll } from '../core/registry';
import type { Extractor } from '../core/types';

const EXTRACTOR_LOADERS = {
  'amazon': { name: 'Amazon', load: () => import('../extractors/amazon') },
  'artificial-analysis': { name: 'Artificial Analysis', load: () => import('../extractors/artificial-analysis') },
  'arxiv': { name: 'arXiv', load: () => import('../extractors/arxiv') },
  'baidu-search': { name: 'Baidu Search', load: () => import('../extractors/baidu-search') },
  'bing': { name: 'Bing Search', load: () => import('../extractors/bing') },
  'bitbucket': { name: 'Bitbucket', load: () => import('../extractors/bitbucket') },
  'booking': { name: 'Booking.com', load: () => import('../extractors/booking') },
  'brave-search': { name: 'Brave Search', load: () => import('../extractors/brave-search') },
  'chatgpt': { name: 'ChatGPT', load: () => import('../extractors/chatgpt') },
  'claude': { name: 'Claude', load: () => import('../extractors/claude') },
  'confluence': { name: 'Confluence', load: () => import('../extractors/confluence') },
  'datadog-dashboard': { name: 'Datadog Dashboard', load: () => import('../extractors/datadog-dashboard') },
  'datadog-docs': { name: 'Datadog Documentation', load: () => import('../extractors/datadog-docs') },
  'datadog-notebook': { name: 'Datadog Notebook', load: () => import('../extractors/datadog-notebook') },
  'deepswe': { name: 'DeepSWE', load: () => import('../extractors/deepswe') },
  'devto': { name: 'Dev.to', load: () => import('../extractors/devto') },
  'discord': { name: 'Discord', load: () => import('../extractors/discord') },
  'documentation': { name: 'Sphinx / Read the Docs', load: () => import('../extractors/documentation') },
  'duckduckgo': { name: 'DuckDuckGo Search', load: () => import('../extractors/duckduckgo') },
  'facebook': { name: 'Facebook', load: () => import('../extractors/facebook') },
  'fox': { name: 'FOX', load: () => import('../extractors/fox') },
  'gemini': { name: 'Gemini', load: () => import('../extractors/gemini') },
  'github': { name: 'GitHub', load: () => import('../extractors/github') },
  'hugging-face': { name: 'Hugging Face', load: () => import('../extractors/hugging-face') },
  'gitlab': { name: 'GitLab', load: () => import('../extractors/gitlab') },
  'globo': { name: 'Globo', load: () => import('../extractors/globo') },
  'gmail': { name: 'Gmail', load: () => import('../extractors/gmail') },
  'google-docs': { name: 'Google Docs', load: () => import('../extractors/google-docs') },
  'google-search': { name: 'Google Search', load: () => import('../extractors/google-search') },
  'google-sheets': { name: 'Google Sheets', load: () => import('../extractors/google-sheets') },
  'google-slides': { name: 'Google Slides', load: () => import('../extractors/google-slides') },
  'grok': { name: 'Grok', load: () => import('../extractors/grok') },
  'grokipedia': { name: 'Grokipedia', load: () => import('../extractors/grokipedia') },
  'hackernews': { name: 'Hacker News', load: () => import('../extractors/hackernews') },
  'instagram': { name: 'Instagram', load: () => import('../extractors/instagram') },
  'jira': { name: 'Jira', load: () => import('../extractors/jira') },
  'leetllm': { name: 'LeetLLM', load: () => import('../extractors/leetllm') },
  'linear': { name: 'Linear', load: () => import('../extractors/linear') },
  'linkedin': { name: 'LinkedIn', load: () => import('../extractors/linkedin') },
  'mdn': { name: 'MDN Web Docs', load: () => import('../extractors/mdn') },
  'medium': { name: 'Medium', load: () => import('../extractors/medium') },
  'meta-ai': { name: 'Meta AI', load: () => import('../extractors/meta-ai') },
  'microsoft-office': { name: 'Microsoft 365', load: () => import('../extractors/microsoft-office') },
  'mlflow': { name: 'MLflow', load: () => import('../extractors/mlflow') },
  'netflix': { name: 'Netflix', load: () => import('../extractors/netflix') },
  'news': { name: 'News (Generic)', load: () => import('../extractors/news') },
  'notion': { name: 'Notion', load: () => import('../extractors/notion') },
  'npm': { name: 'NPM', load: () => import('../extractors/npm') },
  'openrouter': { name: 'OpenRouter', load: () => import('../extractors/openrouter') },
  'perplexity': { name: 'Perplexity', load: () => import('../extractors/perplexity') },
  'pinterest': { name: 'Pinterest', load: () => import('../extractors/pinterest') },
  'polymarket': { name: 'Polymarket', load: () => import('../extractors/polymarket') },
  'pypi': { name: 'PyPI', load: () => import('../extractors/pypi') },
  'reddit': { name: 'Reddit', load: () => import('../extractors/reddit') },
  'slack': { name: 'Slack', load: () => import('../extractors/slack') },
  'stackoverflow': { name: 'Stack Overflow', load: () => import('../extractors/stackoverflow') },
  'substack': { name: 'Substack', load: () => import('../extractors/substack') },
  'temu': { name: 'Temu', load: () => import('../extractors/temu') },
  'tiktok': { name: 'TikTok', load: () => import('../extractors/tiktok') },
  'twitch': { name: 'Twitch', load: () => import('../extractors/twitch') },
  'vk': { name: 'VK', load: () => import('../extractors/vk') },
  'wandb': { name: 'Weights & Biases', load: () => import('../extractors/wandb') },
  'weather': { name: 'Weather.com', load: () => import('../extractors/weather') },
  'whatsapp': { name: 'WhatsApp', load: () => import('../extractors/whatsapp') },
  'wikipedia': { name: 'Wikipedia', load: () => import('../extractors/wikipedia') },
  'x-twitter': { name: 'X (Twitter)', load: () => import('../extractors/x-twitter') },
  'yahoo-search': { name: 'Yahoo Search', load: () => import('../extractors/yahoo-search') },
  'yandex-search': { name: 'Yandex Search', load: () => import('../extractors/yandex-search') },
  'youtube': { name: 'YouTube', load: () => import('../extractors/youtube') },
} as const;

export type ExtractorId = keyof typeof EXTRACTOR_LOADERS;

const AVAILABLE_EXTRACTOR_IDS = Object.freeze(
  Object.keys(EXTRACTOR_LOADERS) as ExtractorId[],
);
const pending = new Map<ExtractorId, Promise<Extractor>>();

export function getAvailableExtractorIds(): readonly ExtractorId[] {
  return AVAILABLE_EXTRACTOR_IDS;
}

export function loadExtractor(id: ExtractorId | string): Promise<Extractor> {
  const normalized = normalizeId(id);
  const existing = pending.get(normalized);
  if (existing) return existing;

  const entry = EXTRACTOR_LOADERS[normalized];
  if (!entry) throw new Error(`Unknown extractor id: ${id}`);

  const loading = entry.load().then(() => {
    const extractor = getAll().find(({ name }) => name === entry.name);
    if (!extractor) throw new Error(`Extractor failed to register: ${normalized}`);
    return extractor;
  });
  pending.set(normalized, loading);
  return loading;
}

export function loadExtractors(ids: readonly (ExtractorId | string)[]): Promise<Extractor[]> {
  return Promise.all(ids.map(loadExtractor));
}

export function loadAllExtractors(): Promise<Extractor[]> {
  return loadExtractors(AVAILABLE_EXTRACTOR_IDS);
}

function normalizeId(value: string): ExtractorId {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-') as ExtractorId;
}
