#!/usr/bin/env tsx

import { assertPublicUrl, auditSanitizedFixture } from './capture-lib';

function expectFailure(action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expected)) return;
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(message)}`);
  }
  throw new Error(`Expected failure containing ${JSON.stringify(expected)}`);
}

async function main(): Promise<void> {
  auditSanitizedFixture('<!doctype html><html><body><main>FIXTURE_MAIN_0001</main></body></html>');
  expectFailure(
    () => auditSanitizedFixture('<html><body><main>Alice Example</main></body></html>'),
    'non-synthetic text',
  );
  expectFailure(
    () => auditSanitizedFixture('<html><body><main>alice@example.com</main></body></html>'),
    'email address',
  );
  expectFailure(
    () => auditSanitizedFixture('<html><body><script>FIXTURE_SCRIPT_0001</script></body></html>'),
    'active or media element',
  );

  try {
    await assertPublicUrl('http://127.0.0.1/private');
    throw new Error('Expected loopback URL rejection');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('public addresses')) throw error;
  }
  try {
    await assertPublicUrl('https://capture.private.localhost/private');
    throw new Error('Expected localhost subdomain rejection');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Localhost capture')) throw error;
  }
  try {
    await assertPublicUrl('http://[::ffff:7f00:1]/private');
    throw new Error('Expected IPv4-mapped loopback rejection');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('public addresses')) throw error;
  }
  console.log('✓ fixture privacy and public-network guards');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
