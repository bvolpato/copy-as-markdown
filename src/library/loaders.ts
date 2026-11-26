import { getAll, matchesExtractor } from '../core/registry';
import type { Extractor } from '../core/types';

const EXTRACTOR_LOADERS = {
  'amazon': { name: 'Amazon', load: () => import('../extractors/amazon') },
  'artificial-analysis': { name: 'Artificial Analysis', load: () => import('../extractors/artificial-analysis') },
  'arxiv': { name: 'arXiv', load: () => import('../extractors/arxiv') },
  'baidu-search': { name: 'Baidu Search', load: () => import('../extractors/baidu-search') },
  'bing': { name: 'Bing Search', load: () => import('../extractors/bing') },
  'bitbucket': { name: 'Bitbucket', load: () => import('../extractors/bitbucket') },
  'bluesky': { name: 'Bluesky', load: () => import('../extractors/bluesky') },
  'booking': { name: 'Booking.com', load: () => import('../extractors/booking') },
  'brave-search': { name: 'Brave Search', load: () => import('../extractors/brave-search') },
  'chatgpt': { name: 'ChatGPT', load: () => import('../extractors/chatgpt') },
  'claude': { name: 'Claude', load: () => import('../extractors/claude') },
  'confluence': { name: 'Confluence', load: () => import('../extractors/confluence') },
  'crates-io': { name: 'crates.io', load: () => import('../extractors/crates-io') },
  'datadog-dashboard': { name: 'Datadog Dashboard', load: () => import('../extractors/datadog-dashboard') },
  'datadog-docs': { name: 'Datadog Documentation', load: () => import('../extractors/datadog-docs') },
  'datadog-notebook': { name: 'Datadog Notebook', load: () => import('../extractors/datadog-notebook') },
  'deepswe': { name: 'DeepSWE', load: () => import('../extractors/deepswe') },
  'deepseek': { name: 'DeepSeek', load: () => import('../extractors/deepseek') },
  'devto': { name: 'Dev.to', load: () => import('../extractors/devto') },
  'discord': { name: 'Discord', load: () => import('../extractors/discord') },
  'discourse': { name: 'Discourse', load: () => import('../extractors/discourse') },
  'docker-hub': { name: 'Docker Hub', load: () => import('../extractors/docker-hub') },
  'documentation': { name: 'Sphinx / Read the Docs', load: () => import('../extractors/documentation') },
  'duckduckgo': { name: 'DuckDuckGo Search', load: () => import('../extractors/duckduckgo') },
  'facebook': { name: 'Facebook', load: () => import('../extractors/facebook') },
  'fox': { name: 'FOX', load: () => import('../extractors/fox') },
  'gemini': { name: 'Gemini', load: () => import('../extractors/gemini') },
  'gemini-notebook': { name: 'Gemini Notebook', load: () => import('../extractors/gemini-notebook') },
  'ghost': { name: 'Ghost / Obsidian Publish', load: () => import('../extractors/ghost') },
  'gitea': { name: 'Codeberg / Gitea', load: () => import('../extractors/gitea') },
  'github': { name: 'GitHub', load: () => import('../extractors/github') },
  'hugging-face': { name: 'Hugging Face', load: () => import('../extractors/hugging-face') },
  'gitlab': { name: 'GitLab', load: () => import('../extractors/gitlab') },
  'globo': { name: 'Globo', load: () => import('../extractors/globo') },
  'gmail': { name: 'Gmail', load: () => import('../extractors/gmail') },
  'google-docs': { name: 'Google Docs', load: () => import('../extractors/google-docs') },
  'google-ai-studio': { name: 'Google AI Studio', load: () => import('../extractors/google-ai-studio') },
  'google-scholar': { name: 'Google Scholar', load: () => import('../extractors/google-scholar') },
  'google-search': { name: 'Google Search', load: () => import('../extractors/google-search') },
  'google-sheets': { name: 'Google Sheets', load: () => import('../extractors/google-sheets') },
  'google-slides': { name: 'Google Slides', load: () => import('../extractors/google-slides') },
  'grafana': { name: 'Grafana', load: () => import('../extractors/grafana') },
  'grok': { name: 'Grok', load: () => import('../extractors/grok') },
  'grokipedia': { name: 'Grokipedia', load: () => import('../extractors/grokipedia') },
  'hackernews': { name: 'Hacker News', load: () => import('../extractors/hackernews') },
  'imdb': { name: 'IMDb', load: () => import('../extractors/imdb') },
  'instagram': { name: 'Instagram', load: () => import('../extractors/instagram') },
  'jira': { name: 'Jira', load: () => import('../extractors/jira') },
  'kalshi': { name: 'Kalshi', load: () => import('../extractors/kalshi') },
  'leetllm': { name: 'LeetLLM', load: () => import('../extractors/leetllm') },
  'linear': { name: 'Linear', load: () => import('../extractors/linear') },
  'linkedin': { name: 'LinkedIn', load: () => import('../extractors/linkedin') },
  'lobsters': { name: 'Lobsters', load: () => import('../extractors/lobsters') },
  'mastodon': { name: 'Mastodon', load: () => import('../extractors/mastodon') },
  'mdn': { name: 'MDN Web Docs', load: () => import('../extractors/mdn') },
  'mediawiki': { name: 'MediaWiki', load: () => import('../extractors/mediawiki') },
  'medium': { name: 'Medium', load: () => import('../extractors/medium') },
  'meta-ai': { name: 'Meta AI', load: () => import('../extractors/meta-ai') },
  'microsoft-copilot': { name: 'Microsoft Copilot', load: () => import('../extractors/microsoft-copilot') },
  'microsoft-office': { name: 'Microsoft 365', load: () => import('../extractors/microsoft-office') },
  'microsoft-teams': { name: 'Microsoft Teams', load: () => import('../extractors/microsoft-teams') },
  'mlflow': { name: 'MLflow', load: () => import('../extractors/mlflow') },
  'mistral-vibe': { name: 'Mistral Vibe', load: () => import('../extractors/mistral-vibe') },
  'netflix': { name: 'Netflix', load: () => import('../extractors/netflix') },
  'news': { name: 'News (Generic)', load: () => import('../extractors/news') },
  'notion': { name: 'Notion', load: () => import('../extractors/notion') },
  'npm': { name: 'NPM', load: () => import('../extractors/npm') },
  'openapi-docs': { name: 'OpenAPI Docs', load: () => import('../extractors/openapi-docs') },
  'openreview': { name: 'OpenReview', load: () => import('../extractors/openreview') },
  'openrouter': { name: 'OpenRouter', load: () => import('../extractors/openrouter') },
  'outlook': { name: 'Outlook Web', load: () => import('../extractors/outlook') },
  'perplexity': { name: 'Perplexity', load: () => import('../extractors/perplexity') },
  'pinterest': { name: 'Pinterest', load: () => import('../extractors/pinterest') },
  'pkg-go': { name: 'pkg.go.dev', load: () => import('../extractors/pkg-go') },
  'polymarket': { name: 'Polymarket', load: () => import('../extractors/polymarket') },
  'pubmed': { name: 'PubMed', load: () => import('../extractors/pubmed') },
  'pypi': { name: 'PyPI', load: () => import('../extractors/pypi') },
  'reddit': { name: 'Reddit', load: () => import('../extractors/reddit') },
  'rubygems': { name: 'RubyGems', load: () => import('../extractors/rubygems') },
  'sec-edgar': { name: 'SEC EDGAR', load: () => import('../extractors/sec-edgar') },
  'semantic-scholar': { name: 'Semantic Scholar', load: () => import('../extractors/semantic-scholar') },
  'sentry': { name: 'Sentry', load: () => import('../extractors/sentry') },
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

  if (!AVAILABLE_EXTRACTOR_IDS.includes(normalized)) {
    return Promise.reject(new Error(`Unknown extractor id: ${id}`));
  }
  const entry = EXTRACTOR_LOADERS[normalized];

  const loading = entry.load().then(() => {
    const variants = getAll().filter(({ name }) => name === entry.name);
    if (variants.length === 0) throw new Error(`Extractor failed to register: ${normalized}`);
    if (variants.length === 1) return variants[0];
    return {
      ...variants[0],
      variants: Object.freeze(variants),
      matches: [...new Set(variants.flatMap((extractor) => extractor.matches))],
      detect: (contextDocument?: Document) => variants.some((extractor) => extractor.detect?.(contextDocument)),
      async extract(optionId?: string): Promise<string> {
        if (typeof window === 'undefined') throw new Error('Site extractors require an active browser page');
        const variant = variants.find((extractor) => matchesExtractor(extractor, window.location.href))
          || variants.find((extractor) => extractor.detect?.(document));
        if (!variant) throw new Error(`No ${entry.name} extractor matches the active browser page`);
        return variant.extract(optionId);
      },
    };
  });
  pending.set(normalized, loading);
  // A failed chunk request must not block later attempts.
  loading.catch(() => pending.delete(normalized));
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
