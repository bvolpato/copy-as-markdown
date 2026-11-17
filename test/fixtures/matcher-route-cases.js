const searchResult = '<main><div class="result"><h2><a class="result__a" href="https://example.org/guide">Markdown guide</a></h2><p class="result__snippet">Keep complete search snippets.</p></div></main>';
const netflixTitle = '<main><h1>Example series</h1><p data-uia="title-info-synopsis">A localized title synopsis.</p><div data-uia="episodes"><div data-uia="episode-card">Episode one description.</div></div></main>';

export const MATCHER_ROUTE_CASES = [
  {
    id: 'confluence-custom-host-heading',
    url: 'https://confluence.corp.example/display/ENG/Plan#heading',
    extractor: 'Confluence',
    html: '<main><h1 id="title-text">Engineering plan</h1><div id="main-content" class="wiki-content"><h2 id="heading">Release plan</h2><p>Keep this anchored page content.</p></div></main>',
    contains: ['# Engineering plan', '## Release plan', 'Keep this anchored page content.'],
  },
  {
    id: 'confluence-context-path-comment',
    url: 'https://internal.example/confluence/pages/viewpage.action?pageId=42#comment-9',
    extractor: 'Confluence',
  },
  {
    id: 'confluence-unrelated-page',
    url: 'https://confluence.corp.example/settings#display/ENG/Plan',
    extractor: null,
  },
  {
    id: 'duckduckgo-html-host',
    url: 'https://html.duckduckgo.com/html/?q=markdown',
    extractor: 'DuckDuckGo Search', html: searchResult,
    contains: ['### 1. Markdown guide', '**URL:** https://example.org/guide', 'Keep complete search snippets.'],
  },
  {
    id: 'duckduckgo-lite-table',
    url: 'https://lite.duckduckgo.com/lite/?q=markdown',
    extractor: 'DuckDuckGo Search',
    html: `<main><table>
      <tr><td>1.</td><td><a rel="nofollow" href="https://example.org/guide" class="result-link">Markdown guide</a></td></tr>
      <tr><td></td><td class="result-snippet">A complete Lite result snippet.</td></tr>
      <tr><td></td><td><span class="link-text">example.org/guide</span></td></tr>
      <tr><td>2.</td><td><a class="result-link" href="https://example.org/reference">Reference without a snippet</a></td></tr>
      <tr><td>3.</td><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsyntax">Syntax reference</a></td></tr>
      <tr><td></td><td class="result-snippet">Third result details.</td></tr>
      <tr><td>4.</td><td><a class="result-link" href="javascript:void(0)">Unsafe result</a></td></tr>
    </table></main>`,
    contains: ['### 1. Markdown guide', 'A complete Lite result snippet.', '### 2. Reference without a snippet', '### 3. Syntax reference', '**URL:** https://example.org/syntax', 'Third result details.'],
    excludes: ['Unsafe result', 'javascript:'],
  },
  ...['safe', 'noai', 'safe-noai'].map(host => ({
    id: `duckduckgo-${host}-host`, url: `https://${host}.duckduckgo.com/?q=markdown`,
    extractor: 'DuckDuckGo Search',
  })),
  {
    id: 'duckduckgo-help-is-not-search',
    url: 'https://safe.duckduckgo.com/duckduckgo-help-pages/features/non-javascript',
    extractor: null,
  },
  {
    id: 'duckduckgo-unrelated-subdomain',
    url: 'https://links.duckduckgo.com/?q=markdown', extractor: null,
  },
  {
    id: 'amazon-gp-product',
    url: 'https://www.amazon.com/gp/product/B08F7PTF53?ref=fixture',
    extractor: 'Amazon',
    html: '<main><h1 id="productTitle">Fixture product</h1><div class="a-price"><span class="a-offscreen">$25.00</span></div><div id="feature-bullets"><ul><li><span class="a-list-item">Durable product feature.</span></li></ul></div><div id="productDescription"><p>Complete product description with useful details.</p></div></main>',
    contains: ['# Fixture product', '**Price:** $25.00', 'Durable product feature.', 'Complete product description with useful details.'],
  },
  ...['co.uk', 'de', 'fr', 'ca', 'com.br', 'com.au', 'co.jp'].map(domain => ({
    id: `amazon-gp-product-${domain}`, url: `https://www.amazon.${domain}/gp/product/B08F7PTF53`,
    extractor: 'Amazon',
  })),
  { id: 'amazon-non-product', url: 'https://www.amazon.com/gp/products/B08F7PTF53', extractor: null },
  {
    id: 'netflix-localized-title',
    url: 'https://www.netflix.com/gb/title/80057281',
    extractor: 'Netflix', html: netflixTitle,
    contains: ['# Example series', '## Synopsis', 'A localized title synopsis.', 'Episode one description.'],
    excludes: ['## Current Episode'],
  },
  {
    id: 'netflix-localized-watch',
    url: 'https://www.netflix.com/br-en/watch/80057281',
    extractor: 'Netflix',
    html: '<main><h1>Example series</h1><p data-uia="video-episode-title">The current episode</p></main>',
    contains: ['## Current Episode', 'The current episode'],
  },
  { id: 'netflix-root-title', url: 'https://www.netflix.com/title/80057281', extractor: 'Netflix' },
  { id: 'netflix-localized-browse', url: 'https://www.netflix.com/gb/browse', extractor: null },
  { id: 'netflix-invalid-title-id', url: 'https://www.netflix.com/gb/title/80057281suffix', extractor: null },
  {
    id: 'weather-city-daily',
    url: 'https://weather.com/gb/england/greater-london/city/london/tenday',
    extractor: 'Weather.com',
    html: '<main><h1 data-testid="LocationTitle">London</h1><section data-testid="daily-forecast"><p>Day / Conditions / Temperature</p><div data-testid="daily-item">Monday sunny, high 18 C.</div><div data-testid="daily-item">Tuesday rain, high 16 C.</div></section></main>',
    contains: ['# London Weather', '## 10-Day Forecast', 'Monday sunny, high 18 C.', 'Tuesday rain, high 16 C.'],
    occurrences: { 'Monday sunny, high 18 C.': 1, 'Tuesday rain, high 16 C.': 1 },
  },
  {
    id: 'weather-localized-city-hourly',
    url: 'https://weather.com/en-GB/gb/england/greater-london/city/london/hourbyhour',
    extractor: 'Weather.com',
    html: '<main><h1 data-testid="LocationTitle">London</h1><div data-testid="hourly-forecast">14:00 light rain, 16 C.</div></main>',
    contains: ['## Hourly Forecast', '14:00 light rain, 16 C.'],
  },
  {
    id: 'weather-city-hourly-day',
    url: 'https://weather.com/gb/england/greater-london/city/london/hourbyhour/day-2',
    extractor: 'Weather.com',
    html: '<main><h1 data-testid="LocationTitle">London</h1><div data-testid="hourly-forecast">Tuesday 14:00 light rain, 16 C.</div></main>',
    contains: ['## Hourly Forecast', 'Tuesday 14:00 light rain, 16 C.'],
  },
  {
    id: 'weather-city-current',
    url: 'https://weather.com/us/new-york/new-york/today',
    extractor: 'Weather.com',
    html: '<main><h1 data-testid="LocationTitle">New York</h1><span data-testid="TemperatureValue">20 C</span><span data-testid="wxPhrase">Clear</span></main>',
    contains: ['# New York Weather', '**Temperature:** 20 C', '**Conditions:** Clear'],
  },
  {
    id: 'weather-city-alerts',
    url: 'https://weather.com/gb/england/greater-london/city/london/alerts',
    extractor: 'Weather.com',
    html: '<main><h1 data-testid="LocationTitle">London</h1><div data-testid="weather-alert">Strong wind advisory.</div></main>',
    contains: ['## Alerts', 'Strong wind advisory.'],
  },
  { id: 'weather-legacy-postcode', url: 'https://weather.com/weather/tenday/l/10001:4:US', extractor: 'Weather.com' },
  { id: 'weather-unrelated-article', url: 'https://weather.com/news/news/forecast-for-today', extractor: null },
  { id: 'weather-invalid-forecast', url: 'https://weather.com/gb/england/greater-london/city/london/tenday-extra', extractor: null },
  { id: 'weather-invalid-hourly-day', url: 'https://weather.com/gb/england/greater-london/city/london/hourbyhour/day-two', extractor: null },
  {
    id: 'pinterest-nested-ideas',
    url: 'https://www.pinterest.com/ideas/diy-and-crafts/934876475639/',
    extractor: 'Pinterest',
    html: '<main><article data-test-id="pin"><h1 data-test-id="pin-title">Paper craft idea</h1><p data-test-id="pin-description">Fold a colorful paper bird.</p><span data-test-id="creator-profile-name">Craft author</span></article></main>',
    contains: ['# Paper craft idea', 'Fold a colorful paper bird.', '**Author:** Craft author'],
  },
  { id: 'pinterest-ideas-root', url: 'https://www.pinterest.com/ideas/', extractor: 'Pinterest' },
  { id: 'pinterest-search', url: 'https://www.pinterest.com/search/pins/?q=crafts', extractor: 'Pinterest' },
  { id: 'pinterest-unrelated-ideas-prefix', url: 'https://www.pinterest.com/ideas-settings/topic/123/', extractor: null },
  { id: 'pinterest-nested-ideas-suffix', url: 'https://www.pinterest.com/ideas/crafts/123/settings', extractor: null },
  {
    id: 'deepseek-root-query-fragment',
    url: 'https://chat.deepseek.com/?utm_source=fixture#chat',
    extractor: 'DeepSeek',
    html: '<main><h1>Fixture conversation</h1><div data-role="user"><div data-testid="message-content">Explain URL matching.</div></div><div data-role="assistant"><div class="ds-markdown"><p>Keep route guards specific.</p></div></div></main>',
    contains: ['Explain URL matching.', 'Keep route guards specific.'],
  },
  { id: 'deepseek-root', url: 'https://chat.deepseek.com/', extractor: 'DeepSeek' },
  { id: 'deepseek-unrelated-route', url: 'https://chat.deepseek.com/downloads/privacy.pdf?from=chat', extractor: null },
  {
    id: 'stackoverflow-tag-list-fallback',
    url: 'https://stackoverflow.com/questions/tagged/javascript',
    extractor: null,
    html: '<main><h1>JavaScript questions</h1><div class="s-post-summary"><h3><a href="/questions/123/example">Keep the listed question</a></h3><p class="s-post-summary--content-excerpt">Keep its useful preview text.</p></div></main>',
    contains: ['Keep the listed question', 'Keep its useful preview text.'],
  },
  {
    id: 'stackoverflow-numeric-question',
    url: 'https://stackoverflow.com/questions/123/example#456',
    extractor: 'Stack Overflow',
    html: '<main><div id="question-header"><h1><a>Specific question</a></h1></div><div class="question"><div class="s-prose"><p>Question details.</p></div></div><div class="answer"><div class="s-prose"><p>Useful answer.</p></div></div></main>',
    contains: ['## Question', 'Question details.', '## Answers', 'Useful answer.'],
  },
  { id: 'stackexchange-numeric-question', url: 'https://unix.stackexchange.com/questions/123/example', extractor: 'Stack Overflow' },
  { id: 'stackoverflow-invalid-question-id', url: 'https://stackoverflow.com/questions/123abc/example', extractor: null },
  { id: 'stackoverflow-ask', url: 'https://stackoverflow.com/questions/ask', extractor: null },
];
