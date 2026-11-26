/**
 * Session credentials in URLs.
 *
 * Some applications put a bearer token or an anti-forgery value of the signed-in
 * viewer in the URLs of their images and attachments. Each rule names its hosts,
 * so that a parameter such as "token" stays in the links of other sites.
 */

type SessionUrlRule = {
  host: RegExp;
  /** Lowercase names of the query parameters that carry a credential. */
  parameters: string[];
  /** The part of the URL that stays useful without the credential. */
  keep: 'other parameters' | 'nothing';
};

// The whole query is the grant: a token, a signed policy, and client IDs. The path still names the file.
const ATLASSIAN_MEDIA_HOST = /^(?:media-cdn|(?:[\w-]+\.)*media)\.atlassian(?:-us-gov-mod)?\.com$/;

const SESSION_URL_RULES: SessionUrlRule[] = [
  {
    host: /^(?:attachments(?:-sdf)?\.office\.net|attachment\.outlook\.(?:live|office)\.net)$/,
    parameters: ['token', 'x-owa-canary'],
    keep: 'nothing',
  },
  {
    host: /^outlook\.(?:office\.com|office365\.(?:com|us)|live\.com|cloud\.microsoft)$/,
    parameters: ['x-owa-canary'],
    keep: 'nothing',
  },
  { host: /(?:^|\.)officeapps\.live\.com$/, parameters: ['access_token'], keep: 'other parameters' },
  { host: /\.atlassian\.net$/, parameters: ['atl_token'], keep: 'other parameters' },
];

/** Return the URL without session credentials, or an empty string when nothing useful is left. */
export function removeSessionCredentials(url: URL): string {
  if (ATLASSIAN_MEDIA_HOST.test(url.hostname)) return url.origin + url.pathname;
  const rule = SESSION_URL_RULES.find(({ host }) => host.test(url.hostname));
  const names = Array.from(url.searchParams.keys())
    // Markdown text can escape the underscore of a name.
    .filter((name) => rule?.parameters.includes(name.replace(/\\/g, '').toLowerCase()));
  if (names.length === 0) return url.href;
  if (rule?.keep === 'nothing') return '';
  const cleaned = new URL(url.href);
  names.forEach((name) => cleaned.searchParams.delete(name));
  return cleaned.href;
}

// A link target ends at its parenthesis. A URL in prose can contain one, and ends before a link target.
const URL_IN_TEXT = /\]\((https?:\/\/[^\s)<>"]+)|https?:\/\/(?:(?!\]\()[^\s<>"`])+/gi;

/** Clean the URLs that a text contains, for example in a link label or in a metadata value. */
export function removeSessionCredentialsFromText(text: string): string {
  return text.replace(URL_IN_TEXT, (match: string, target?: string) => {
    if (target) return `](${cleanTextUrl(target)}`;
    let end = match.length;
    while (")]}.,;:!?*'".includes(match[end - 1])) end -= 1;
    return cleanTextUrl(match.slice(0, end)) + match.slice(end);
  });
}

function cleanTextUrl(value: string): string {
  if (!/[?#]/.test(value)) return value;
  try {
    const url = new URL(value);
    const cleaned = removeSessionCredentials(url);
    return cleaned === url.href ? value : cleaned || value.split(/[?#]/)[0];
  } catch {
    return value;
  }
}
