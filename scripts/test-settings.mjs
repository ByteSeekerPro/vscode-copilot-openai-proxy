#!/usr/bin/env node
// scripts/test-settings.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

//
// Validates that package.json contributes.configuration contains all required
// settings with correct types and defaults. Also validates config reader keys
// match package.json property names.
//
// Usage:
//   node scripts/test-settings.mjs

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const SECTION = 'vscode-copilot-openai-proxy';
const props = pkg.contributes?.configuration?.properties ?? {};

let passed = 0;
let failed = 0;
const failures = [];

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = `  ✗ ${name} — ${err.message}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message ? message + ': ' : '') +
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function getSetting(key) {
  return props[`${SECTION}.${key}`];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n  Package.json Settings Validation Tests\n');

// --- Required settings exist ---
console.log('Required settings exist');

it('package.json has port setting', () => {
  assert(getSetting('port'), 'port setting missing');
});

it('package.json has host setting', () => {
  assert(getSetting('host'), 'host setting missing');
});

it('package.json has callHistoryRetentionDays setting', () => {
  assert(getSetting('callHistoryRetentionDays'), 'callHistoryRetentionDays setting missing');
});

it('package.json has autoStart setting', () => {
  assert(getSetting('autoStart'), 'autoStart setting missing');
});

it('package.json has toolChoicePolicy setting', () => {
  assert(getSetting('toolChoicePolicy'), 'toolChoicePolicy setting missing');
});

it('package.json has requireApiKey setting', () => {
  assert(getSetting('requireApiKey'), 'requireApiKey setting missing');
});

it('package.json has apiKey setting', () => {
  assert(getSetting('apiKey'), 'apiKey setting missing');
});

// --- Setting types ---
console.log('\nSetting types');

it('port is integer', () => {
  assertEqual(getSetting('port').type, 'integer');
});

it('host is string', () => {
  assertEqual(getSetting('host').type, 'string');
});

it('callHistoryRetentionDays is integer', () => {
  assertEqual(getSetting('callHistoryRetentionDays').type, 'integer');
});

it('autoStart is boolean', () => {
  assertEqual(getSetting('autoStart').type, 'boolean');
});

it('toolChoicePolicy is string', () => {
  assertEqual(getSetting('toolChoicePolicy').type, 'string');
});

it('requireApiKey is boolean', () => {
  assertEqual(getSetting('requireApiKey').type, 'boolean');
});

it('apiKey is string', () => {
  assertEqual(getSetting('apiKey').type, 'string');
});

// --- Default values ---
console.log('\nDefault values');

it('default port is 9090', () => {
  assertEqual(getSetting('port').default, 9090);
});

it('default host is 127.0.0.1', () => {
  assertEqual(getSetting('host').default, '127.0.0.1');
});

it('default callHistoryRetentionDays is 10', () => {
  assertEqual(getSetting('callHistoryRetentionDays').default, 10);
});

it('default autoStart is true', () => {
  assertEqual(getSetting('autoStart').default, true);
});

it('default toolChoicePolicy is bestEffort', () => {
  assertEqual(getSetting('toolChoicePolicy').default, 'bestEffort');
});

it('default requireApiKey is false', () => {
  assertEqual(getSetting('requireApiKey').default, false);
});

it('default apiKey is empty string', () => {
  assertEqual(getSetting('apiKey').default, '');
});

// --- Config reader key alignment ---
// The config readers in src/config.ts use workspace.getConfiguration(SECTION)
// with short property names. Verify that the short names match what's in package.json.
console.log('\nConfig reader key alignment (short property names)');

const expectedShortKeys = [
  'port',
  'host',
  'callHistoryRetentionDays',
  'autoStart',
  'toolChoicePolicy',
  'requireApiKey',
  'apiKey',
];

for (const key of expectedShortKeys) {
  it(`package.json defines ${SECTION}.${key}`, () => {
    assert(props[`${SECTION}.${key}`], `${SECTION}.${key} not found in contributes.configuration.properties`);
  });
}

// --- toolChoicePolicy enum values ---
console.log('\ntoolChoicePolicy enum values');

it('toolChoicePolicy enum contains bestEffort', () => {
  assert(getSetting('toolChoicePolicy').enum.includes('bestEffort'));
});

it('toolChoicePolicy enum contains strictPreflight', () => {
  assert(getSetting('toolChoicePolicy').enum.includes('strictPreflight'));
});

it('toolChoicePolicy enum contains strictAfterResponse', () => {
  assert(getSetting('toolChoicePolicy').enum.includes('strictAfterResponse'));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    ${f}`);
  }
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
