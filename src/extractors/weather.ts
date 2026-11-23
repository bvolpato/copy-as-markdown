/**
 * Weather.com extractor for current, hourly, daily, and alert pages.
 * Copies visible forecast rows and a small set of structured fields, never site navigation.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Weather.com',
  matches: [
    '*://www.weather.com/*',
    '*://weather.com/*',
  ],
  pathnameRegex: /^(?:\/[a-z]{2}-[a-z]{2})?\/(?:weather\/(?:today|hourbyhour|tenday|weekend|monthly|5day|airquality|alerts)\/[^/]+(?:\/[^/]+)*|[a-z]{2}\/(?:[^/]+\/)+(?:today|tenday|weekend|monthly|5day|airquality|alerts|hourbyhour(?:\/day-\d+)?))\/?$/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="CurrentConditions"]',
      '[data-testid*="CurrentConditions"]',
      '[data-testid*="Forecast"] h2',
      'h1',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = routeKind(window.location.pathname);
    const payload = firstWeatherPayload();
    const scope: ParentNode = document.querySelector('main') || document;
    const location = firstText([
      '[data-testid="LocationTitle"]',
      '[data-testid*="Location"]',
      '[class*="CurrentConditions--location--"]',
      'h1',
    ], false, scope) || stringValue(payload?.location) || Utils.getPageTitle();
    const temperature = firstText([
      '[data-testid="TemperatureValue"]',
      '[data-testid*="TemperatureValue"]',
      '[data-testid*="Temperature"]',
      '[class*="CurrentConditions--tempValue--"]',
    ], false, scope) || valueFromPayload(payload, ['temperature', 'temperatureValue', 'temp']);
    const condition = firstText([
      '[data-testid="wxPhrase"]',
      '[data-testid*="wxPhrase"]',
      '[data-testid*="Condition"]',
      '[class*="CurrentConditions--phraseValue--"]',
    ], false, scope) || valueFromPayload(payload, ['condition', 'phrase', 'wxPhrase']);
    const feelsLike = firstText([
      '[data-testid="FeelsLike"]',
      '[data-testid*="FeelsLike"]',
      '[data-testid*="feelsLike"]',
    ], false, scope) || valueFromPayload(payload, ['feelsLike', 'feels_like']);
    const humidity = firstText([
      '[data-testid="Humidity"]',
      '[data-testid*="Humidity"]',
    ], false, scope) || valueFromPayload(payload, ['humidity']);
    const wind = firstText([
      '[data-testid="Wind"]',
      '[data-testid*="Wind"]',
    ], false, scope) || valueFromPayload(payload, ['wind', 'windSpeed']);
    const updated = firstText([
      'time[datetime]',
      '[data-testid*="ObservationTime"]',
      '[data-testid*="Updated"]',
    ], true, scope);

    const metadata: Record<string, string> = {
      source: 'Weather.com', title: `${location} weather`, url, route,
      location, temperature, condition, feels_like: feelsLike, humidity, wind, updated,
    };
    const parts: string[] = [`# ${location} Weather`, ''];
    if (temperature) parts.push(`**Temperature:** ${temperature}`);
    if (condition) parts.push(`**Conditions:** ${condition}`);
    if (feelsLike) parts.push(`**Feels like:** ${feelsLike}`);
    if (humidity) parts.push(`**Humidity:** ${humidity}`);
    if (wind) parts.push(`**Wind:** ${wind}`);
    if (updated) parts.push(`**Updated:** ${updated}`);
    parts.push('');

    if (route === 'alerts') {
      const alerts = extractRows([
        '[data-testid*="Alert"]',
        '[data-testid*="alert"]',
        '[class*="Alert"]',
        '[class*="alert"]',
      ], scope);
      parts.push('## Alerts', '');
      if (alerts.length) parts.push(...alerts.map((alert) => `- ${alert}`));
      else parts.push('*No alert details currently visible.*');
      parts.push('');
    } else if (route === 'hourly') {
      const rows = extractRows([
        '[data-testid*="HourlyForecast"] [data-testid*="Details"]',
        '[data-testid*="HourlyForecast"]',
        '[data-testid*="hourly"]',
        '[class*="HourlyForecast"]',
      ], scope);
      if (rows.length) parts.push('## Hourly Forecast', '', ...rows.map((row) => `- ${row}`), '');
    } else if (route === 'daily') {
      const rows = extractRows(
        scope.querySelector('[data-testid="daily-item"]')
          ? ['[data-testid="daily-item"]']
          : [
            '[data-testid*="DailyForecast"] [data-testid*="Details"]',
            '[data-testid*="DailyForecast"]',
            '[data-testid*="daily"]',
            '[class*="DailyForecast"]',
          ],
        scope,
      );
      if (rows.length) parts.push('## 10-Day Forecast', '', ...rows.map((row) => `- ${row}`), '');
    } else if (route === 'airquality') {
      const rows = extractRows([
        '[data-testid*="AirQuality"]',
        '[class*="AirQuality"]',
      ], scope);
      if (rows.length) parts.push('## Air Quality', '', ...rows.map((row) => `- ${row}`), '');
    }

    const summary = firstText([
      '[data-testid="CurrentConditions"] [data-testid*="Summary"]',
      '[data-testid*="ForecastSummary"]',
      '[data-testid*="Description"]',
    ], false, scope);
    if (summary && summary !== condition) parts.push('## Forecast Summary', '', summary, '');
    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonRecord = Record<string, unknown>;

function routeKind(pathname: string): string {
  const stripped = pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, '');
  const forecast = (
    stripped.match(/^\/weather\/([^/]+)\//i)?.[1]
    || stripped.match(/\/(today|hourbyhour|tenday|weekend|monthly|5day|airquality|alerts)(?:\/day-\d+)?\/?$/i)?.[1]
    || ''
  ).toLowerCase();
  if (forecast === 'hourbyhour') return 'hourly';
  if (forecast === 'tenday' || forecast === '5day' || forecast === 'weekend' || forecast === 'monthly') return 'daily';
  if (forecast === 'alerts') return 'alerts';
  if (forecast === 'airquality') return 'airquality';
  return 'current';
}

function firstText(selectors: string[], attributeMode = false, scope: ParentNode = document): string {
  for (const selector of selectors) {
    const element = scope.querySelector(selector) || (scope !== document ? document.querySelector(selector) : null);
    if (!element) continue;
    const value = attributeMode
      ? element.getAttribute('content') || element.getAttribute('datetime') || element.textContent || ''
      : element.textContent || '';
    const text = value.trim();
    if (text) return text;
  }
  return '';
}

function extractRows(selectors: string[], scope: ParentNode = document): string[] {
  const elements: Element[] = [];
  const seenElements = new Set<Element>();
  for (const selector of selectors) {
    for (const element of scope.querySelectorAll(selector)) {
      if (seenElements.has(element)) continue;
      seenElements.add(element);
      elements.push(element);
    }
  }
  const leafElements = elements.filter(
    (element) => !elements.some((other) => other !== element && element.contains(other)),
  );
  const seenText = new Set<string>();
  const rows: string[] = [];
  for (const element of leafElements) {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    rows.push(text);
  }
  return rows;
}

function firstWeatherPayload(): JsonRecord | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"], script#__NEXT_DATA__, script[id*="state"], script[id*="State"], script[id*="weather"]',
  );
  for (const script of scripts) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    if (!/"(?:temperature|temperatureValue|wxPhrase|currentConditions|forecasts)"/.test(raw)) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const found = findWeatherRecord(parsed);
      if (found) return found;
    } catch {
      // Ignore script fragments that are not complete JSON.
    }
  }
  return null;
}

function findWeatherRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 7 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findWeatherRecord(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as JsonRecord;
  if (
    record.temperature !== undefined
    || record.temperatureValue !== undefined
    || record.wxPhrase !== undefined
    || record.currentConditions !== undefined
    || record.forecasts !== undefined
  ) {
    return record;
  }
  for (const child of Object.values(record)) {
    const found = findWeatherRecord(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function valueFromPayload(payload: JsonRecord | null, keys: string[]): string {
  if (!payload) return '';
  for (const key of keys) {
    const value = payload[key];
    const text = stringValue(value) || stringValue(asRecord(value)?.value);
    if (text) return text;
  }
  return '';
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
