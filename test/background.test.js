import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backgroundCode = fs.readFileSync(path.join(ROOT, 'dist', 'firefox', 'background.js'), 'utf8');
const AUTOMATIC_PAGE_BUTTON_MATCHES = [
  '*://*.datadoghq.com/dashboard/*',
  '*://*.datadoghq.eu/dashboard/*',
  '*://*.ddog-gov.com/dashboard/*',
  '*://*.datadoghq.com/notebook/*',
  '*://*.datadoghq.eu/notebook/*',
  '*://*.ddog-gov.com/notebook/*',
  '*://wandb.ai/*/*/runs/*',
  '*://*.wandb.ai/*/*/runs/*',
];

function createAction() {
  const calls = [];
  let clickListener;

  return {
    calls,
    action: {
      onClicked: {
        addListener(listener) {
          clickListener = listener;
        },
      },
      setBadgeText(details) {
        calls.push(['badge', details]);
      },
      setBadgeBackgroundColor(details) {
        calls.push(['color', details]);
      },
      setTitle(details) {
        calls.push(['title', details]);
      },
    },
    click(tab) {
      assert.ok(clickListener, 'action click listener was not registered');
      clickListener(tab);
    },
  };
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

function runBackground(chrome, testConsole = console) {
  vm.runInNewContext(backgroundCode, {
    chrome,
    console: testConsole,
    Map,
    Promise,
    Error,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
}

async function testFirefoxCallbackFlow() {
  const toolbar = createAction();
  const runtime = { lastError: undefined };
  let sendCount = 0;
  let injectCount = 0;

  const chrome = {
    browserAction: toolbar.action,
    runtime,
    tabs: {
      sendMessage(tabId, message, callback) {
        sendCount += 1;
        assert.equal(tabId, 7);
        assert.equal(message.action, 'copy-as-markdown');

        if (sendCount === 1) {
          runtime.lastError = { message: 'Could not establish connection' };
          callback(undefined);
          runtime.lastError = undefined;
        } else {
          callback({ success: true });
        }
      },
      executeScript(tabId, details, callback) {
        injectCount += 1;
        assert.equal(tabId, 7);
        assert.equal(details.file, 'content.js');
        callback([]);
      },
    },
  };

  runBackground(chrome);
  toolbar.click({ id: 7 });

  await waitFor(
    () => toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === '✓'),
    'Firefox callback flow did not report success',
  );
  assert.equal(sendCount, 2);
  assert.equal(injectCount, 1);
  assert.equal(
    toolbar.calls.filter(([kind]) => kind === 'badge').map(([, details]) => details.text).join(','),
    ['…', '✓'].join(','),
  );
}

async function testChromePromiseInjectionFlow() {
  const toolbar = createAction();
  const runtime = { lastError: undefined };
  let sendCount = 0;
  let injectCount = 0;

  const chrome = {
    action: toolbar.action,
    runtime,
    scripting: {
      async executeScript(details) {
        injectCount += 1;
        assert.equal(details.target.tabId, 11);
        assert.equal(details.files.join(','), 'content.js');
      },
    },
    tabs: {
      sendMessage(tabId, message, callback) {
        sendCount += 1;
        assert.equal(tabId, 11);
        assert.equal(message.action, 'copy-as-markdown');

        if (sendCount === 1) {
          runtime.lastError = { message: 'Receiving end does not exist' };
          callback(undefined);
          runtime.lastError = undefined;
        } else {
          callback({ success: true });
        }
      },
    },
  };

  runBackground(chrome);
  toolbar.click({ id: 11 });

  await waitFor(
    () => toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === '✓'),
    'Chrome injection flow did not report success',
  );
  assert.equal(sendCount, 2);
  assert.equal(injectCount, 1);
}

async function testRestrictedPageFeedback() {
  const toolbar = createAction();
  const runtime = { lastError: undefined };

  const chrome = {
    browserAction: toolbar.action,
    runtime,
    tabs: {
      sendMessage(tabId, message, callback) {
        runtime.lastError = { message: 'Could not establish connection' };
        callback(undefined);
        runtime.lastError = undefined;
      },
      executeScript(tabId, details, callback) {
        runtime.lastError = { message: 'Missing host permission for the tab' };
        callback(undefined);
        runtime.lastError = undefined;
      },
    },
  };

  runBackground(chrome, { ...console, error() {} });
  toolbar.click({ id: 19 });

  await waitFor(
    () => toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === '!'),
    'restricted page did not report failure',
  );
  assert.ok(toolbar.calls.some(
    ([kind, details]) => kind === 'title'
      && details.title === 'Copy as Markdown: unavailable on this page',
  ));
}

function testAutomaticContentScripts() {
  for (const target of ['chrome', 'firefox']) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'dist', target, 'manifest.json'), 'utf8'),
    );
    assert.deepEqual(
      manifest.content_scripts,
      [{
        matches: AUTOMATIC_PAGE_BUTTON_MATCHES,
        js: ['content.js'],
        run_at: 'document_idle',
      }],
      `${target} manifest automatic page-button routes changed unexpectedly`,
    );
  }
}

async function testCancelledOptionFlow() {
  const toolbar = createAction();
  const runtime = { lastError: undefined };

  const chrome = {
    action: toolbar.action,
    runtime,
    tabs: {
      sendMessage(_tabId, _message, callback) {
        callback({ success: true, copied: false });
      },
    },
  };

  runBackground(chrome);
  toolbar.click({ id: 23 });

  await waitFor(
    () => toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === ''),
    'cancelled copy did not clear toolbar badge',
  );
  assert.ok(
    !toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === '✓'),
    'cancelled copy must not show success checkmark',
  );
}

async function testNavigationDuringCopy() {
  const failures = [
    'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
    'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
    undefined,
  ];
  for (const message of failures) {
    const toolbar = createAction();
    const runtime = { lastError: undefined };
    let sendCount = 0;
    let injectCount = 0;

    const chrome = {
      action: toolbar.action,
      runtime,
      scripting: {
        async executeScript() {
          injectCount += 1;
        },
      },
      tabs: {
        sendMessage(_tabId, _message, callback) {
          sendCount += 1;
          if (sendCount > 1) {
            callback({ success: true });
            return;
          }
          if (message) runtime.lastError = { message };
          callback(undefined);
          runtime.lastError = undefined;
        },
      },
    };

    runBackground(chrome, { ...console, error() {} });
    toolbar.click({ id: 29 });

    await waitFor(
      () => toolbar.calls.some(([kind, details]) => kind === 'badge' && details.text === '!'),
      `copy interrupted by navigation did not report failure: ${message}`,
    );
    assert.equal(sendCount, 1, 'copy interrupted by navigation was repeated on the next page');
    assert.equal(injectCount, 0, 'copy interrupted by navigation was injected into the next page');
  }
}

await testFirefoxCallbackFlow();
await testChromePromiseInjectionFlow();
await testRestrictedPageFeedback();
await testCancelledOptionFlow();
await testNavigationDuringCopy();
testAutomaticContentScripts();
console.log('✅ Background click, injection, and toolbar feedback checks passed');
