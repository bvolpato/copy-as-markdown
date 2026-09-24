import assert from 'node:assert/strict';
import * as library from '../dist/library/index.js';

const facebook = await library.loadExtractor('facebook');
const matcher = library.createExtractorMatcher({ extractors: [facebook] });
const hosts = ['www.facebook.com', 'facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'm.facebook.com'];

for (const host of hosts) {
  for (const path of [
    '/', '/?sk=h_chr', '/#newsfeed', '/NASA/', '/NASA/?ref=page_internal',
    '/NASA/posts/123', '/groups/456/posts/123', '/reel/123', '/NASA/videos/123',
    '/watch/?v=123', '/permalink.php?story_fbid=123', '/story.php?story_fbid=123',
    '/photo.php?fbid=123', '/share/p/123', '/share/r/123', '/events/123/',
  ]) {
    const url = `https://${host}${path}`;
    assert.equal(matcher.match({ url })?.name, 'Facebook', url);
  }
  for (const path of [
    '/settings', '/messages', '/notifications', '/marketplace/', '/gaming/',
    '/friends/', '/groups/', '/events/', '/pages/', '/reels/', '/share/',
    '/login', '/logout', '/help/', '/privacy/', '/NASA/unsupported',
  ]) {
    const url = `https://${host}${path}`;
    assert.equal(matcher.match({ url }), null, url);
  }
}

for (const url of [
  'https://www.facebook.com.evil.test/NASA/',
  'https://evilfacebook.com/NASA/',
  'https://facebook.com@evil.test/NASA/',
  'https://evil.test/?next=https://www.facebook.com/NASA/',
  'file://www.facebook.com/NASA/',
]) {
  assert.equal(matcher.match({ url }), null, url);
}

console.log('Facebook URL detector regression checks passed');
