# Supported sites

<!-- count -->97<!-- /count --> sites and platforms have their own extractor. On every other site, the general extractor finds the main content or copies your selection.

This list is generated from [docs/sites.json](docs/sites.json). Edit that file, and then run `pnpm build:site`.

<!-- sites:start -->

## AI assistants

| Site | What you get |
| --- | --- |
| **ChatGPT** | User and assistant turns in order, canvas writing blocks, code, model, and images |
| **Claude** | User and assistant turns in order, code, citations, and images |
| **Gemini** | User and model turns in order, code, citations, and images |
| **Gemini Notebook / NotebookLM** | Notebook chats, grounded answers, source citations, files, and rendered Studio artifacts |
| **Google AI Studio** | Saved and new chat prompts, system instructions, turns, model, citations, code, and files |
| **Perplexity** | User and assistant turns in order, with citations and source links |
| **Grok** | User and assistant turns in order, citations, code, and images |
| **Meta AI** | User and assistant turns in order, citations, code, and images |
| **Microsoft Copilot** | Consumer chats and shared chats, citations, code, files, images, and rendered Copilot Pages |
| **Mistral Vibe / Le Chat** | Turns in order, citations, files, code, images, workspace context, and rendered Canvas output |
| **DeepSeek** | Signed-in and shared chats, citations, reasoning, code, files, and images |

## AI models and experiments

| Site | What you get |
| --- | --- |
| **Hugging Face** | Model, dataset, and Space cards, metadata, tensor details, evaluation results, lineage, and file listings |
| **OpenRouter** | Model definitions, modalities, pricing, limits, parameters, benchmarks, and provider endpoints |
| **Artificial Analysis** | Published leaderboards, model overviews, exact benchmark values, specifications, and FAQ |
| **DeepSWE** | Benchmark overview, leaderboard configurations, efficiency metrics, methodology, and task examples |
| **Weights & Biases** | Run metadata, configuration, metric summaries, sparklines, and sampled history tables |
| **MLflow** | Self-hosted run metadata, chart comparisons for visible runs, and metric-history tables |
| **LeetLLM** | Lessons, glossary pages, practice content, code, and links |

## Code and packages

| Site | What you get |
| --- | --- |
| **GitHub** | Issues, pull requests, repositories with READMEs, full code files, and canonical patches |
| **GitLab** | Repositories, trees, code files, issues, merge requests, comments, and visible diffs |
| **Bitbucket** | Repositories, source files, pull requests, issues, comments, and visible diffs |
| **Codeberg / Gitea / Forgejo** | Repositories, source files, issues, and pull requests on hosted or self-hosted instances |
| **npm** | Package version, description, README, dependencies, and metadata |
| **PyPI** | Package version, summary, install command, and README |
| **crates.io** | Crate version, metadata, and README |
| **pkg.go.dev** | Go package documentation, index, functions, types, and examples |
| **RubyGems** | Gem version, description, dependencies, and metadata |
| **Docker Hub** | Repository and official image overviews with metadata |

## Documentation and reference

| Site | What you get |
| --- | --- |
| **Documentation frameworks** | Sphinx, Read the Docs, Docusaurus, MkDocs, VitePress, Starlight, mdBook, Nextra, Mintlify, GitBook, Fumadocs, and Fern, on any domain |
| **MDN Web Docs** | Reference pages, guides, code examples, and compatibility tables |
| **Datadog Documentation** | Authored Markdown source when the site serves it, cleaned page content otherwise |
| **OpenAPI docs** | Rendered Swagger UI, Redoc, and Scalar API references on any domain |
| **Wikipedia** | Article body, tables, infoboxes, citations, and references |
| **MediaWiki** | ArchWiki, Fandom, Wiktionary, and other MediaWiki sites on any domain |
| **Grokipedia** | Full article content with metadata |

## Work and documents

| Site | What you get |
| --- | --- |
| **Google Docs** | Full document export with headings, lists, tables, links, images, and off-screen content |
| **Google Sheets** | The complete active sheet or the selected range |
| **Google Slides** | The current slide or the full deck, with titles, text, links, and speaker notes when available |
| **Gmail** | Full threads with participants, message bodies, links, images, and attachments |
| **Outlook on the web** | Email threads with subject, participants, and message bodies |
| **Notion** | Pages and databases with properties, rich blocks, tables, code, and rendered rows |
| **Linear** | Issues, projects, and documents with properties, descriptions, links, and visible comments |
| **Jira** | Issue fields, descriptions, comments, and links, from the API or the rendered page |
| **Confluence** | Page body, labels, tables, code, and visible comments, from the API or the rendered page |
| **Microsoft 365** | Word, Excel, and PowerPoint web content |

## Chat and communities

| Site | What you get |
| --- | --- |
| **Slack** | Loaded channel and thread messages with authors, timestamps, reactions, and attachments |
| **Microsoft Teams** | Loaded chats, channels, and threads with authors, timestamps, replies, reactions, and code |
| **Discord** | Loaded channels and threads with authors, timestamps, replies, reactions, and attachments |
| **WhatsApp Web** | Loaded chat messages with sender, timestamp, and media indicators |
| **Reddit** | Post, subreddit, author, score, and threaded comments with depth |
| **Hacker News** | Story, link, score, author, and nested comments with depth |
| **Lobsters** | Story, link, tags, and nested comments |
| **Stack Overflow / Stack Exchange** | Question, votes, tags, all answers with the accepted one marked, and comments |
| **Discourse** | Forum topics and posts on any Discourse instance |

## Observability

| Site | What you get |
| --- | --- |
| **Datadog dashboards** | Timeframe, template variables, grouped widget values, top lists, and chart annotations |
| **Datadog notebooks** | Metadata, narrative, ordered visualization cells, and chart annotations |
| **Grafana** | Dashboards and Explore on self-hosted or Grafana Cloud instances |
| **Sentry** | Issues, stack traces, tags, and breadcrumbs |

## Search engines

| Site | What you get |
| --- | --- |
| **Google Search** | Query, featured snippets, knowledge panel, ranked results, and People Also Ask |
| **Bing** | Query, results, knowledge sidebar, and related searches |
| **DuckDuckGo** | Query, ranked results, snippets, destination links, and related searches |
| **Brave Search** | Query, answer cards, ranked results, discussions, and related searches |
| **Yahoo Search** | Query, ranked results, snippets, and destination links |
| **Yandex Search** | Query, answer cards, ranked results, and related searches |
| **Baidu Search** | Query, ranked results, abstracts, and destination links |

## Research, filings, and markets

| Site | What you get |
| --- | --- |
| **arXiv** | Title, authors, abstract, subjects, DOI, and the full body from HTML pages |
| **OpenReview** | Papers, abstracts, reviews, rebuttals, and decisions |
| **PubMed / PMC** | Citation, authors, abstract, and identifiers |
| **Semantic Scholar** | Paper title, authors, abstract, and metadata |
| **Google Scholar** | Search results and author profiles |
| **SEC EDGAR** | 10-K, 10-Q, 8-K, S-1, and other filings |
| **Polymarket** | Market, outcome probabilities, volume, and resolution rules |
| **Kalshi** | Market, outcome prices, and rules |

## Social, video, and entertainment

| Site | What you get |
| --- | --- |
| **YouTube** | Title, channel, views, description, chapters, comments, and transcript |
| **X (Twitter)** | Posts with loaded replies and media, timelines, and searches with engagement counts |
| **Bluesky** | Post threads and profiles |
| **Mastodon** | Posts and threads on any Mastodon instance |
| **LinkedIn** | Profiles, posts with reactions and comments, and articles |
| **Facebook** | Posts and reels with author, caption, engagement, and visible comments |
| **Instagram** | Posts and reels with captions, media descriptions, engagement, and visible comments |
| **TikTok** | Videos with creator, caption, engagement, transcript or captions, and visible comments |
| **Pinterest** | Pins with creator, description, destination, media, and visible comments |
| **VK** | Posts with author, timestamp, text, media, and visible comments |
| **Twitch** | Channels, streams, videos, and clips with game, viewers, tags, and description |
| **Netflix** | Title, synopsis, cast, genres, ratings, seasons, and visible episodes |
| **IMDb** | Title, rating, cast, and synopsis |
| **FOX** | Shows, episodes, movies, and videos with synopsis and details |

## News and publishing

| Site | What you get |
| --- | --- |
| **News sites** | CNN, BBC, NYT, Reuters, Fox News, and more: article body, author, date, and paywall detection |
| **Globo** | Articles and videos with headline, author, date, and body |
| **Medium** | Article, author, publication, claps, and reading time |
| **Substack** | Newsletter posts with author, date, likes, and paywall state |
| **DEV Community** | Article, author, tags, reactions, and comments |
| **Ghost / Obsidian Publish** | Posts and notes on any custom domain |

## Shopping, travel, and weather

| Site | What you get |
| --- | --- |
| **Amazon** | Title, ASIN, price, rating, features, specifications, and top reviews |
| **Temu** | Title, price, availability, ratings, variants, specifications, and description |
| **Booking.com** | Hotels and search results with prices, scores, facilities, policies, and availability |
| **Weather.com** | Current conditions, alerts, hourly outlook, and daily forecast |

<!-- sites:end -->

## What a copy contains

A copy contains content that the site has loaded, or content that its export or API returns. Load or expand the relevant sections before you copy. Pagination, virtualized history, canvas-only views, and paywalls can hide content.

AI chat extractors use rendered page content only, and the output says that coverage is limited to visible content. When an app virtualizes its history or shows a control that loads older messages, the output also warns that older content was not loaded.

## Metric histories

W&B returns up to 500 sampled history rows for each metric through its browser GraphQL API.

MLflow run history requests are paginated, up to 10,000 points per metric. MLflow chart comparisons include up to 10 visible runs and 50 loaded run-metric series, with up to 2,500 points per series.

Both integrations include statistics for the full series. They sample the history rows evenly when needed, so that the clipboard output stays small.

W&B Server and self-hosted MLflow work through userscript content detection or the extension toolbar. The active browser session must allow same-origin API access.
