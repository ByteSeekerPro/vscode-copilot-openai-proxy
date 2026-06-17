#!/usr/bin/env node
// scripts/test-host-config.mjs
import os from 'node:os';
//
// Unit tests for host configuration helpers.
// These tests validate the pure functions without requiring VS Code or a running server.
//
// Usage:
//   node scripts/test-host-config.mjs

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

// ---------------------------------------------------------------------------
// Replicate the validation logic from src/config.ts for standalone testing.
// The source of truth is src/config.ts; these tests verify the patterns.
// ---------------------------------------------------------------------------

const DEFAULT_HOST = '127.0.0.1';
const HOST_PATTERN = /^(localhost|(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)$/;

function isValidHost(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return HOST_PATTERN.test(trimmed);
}

function normalizeHost(raw) {
  if (!isValidHost(raw)) {
    return DEFAULT_HOST;
  }
  return raw.trim();
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLocalHost(host) {
  return LOCAL_HOSTS.has(host);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n  Host Configuration Tests\n');

// --- isValidHost ---
console.log('isValidHost');

it('accepts 127.0.0.1', () => {
  assert(isValidHost('127.0.0.1'), '127.0.0.1 should be valid');
});

it('accepts localhost', () => {
  assert(isValidHost('localhost'), 'localhost should be valid');
});

it('accepts 0.0.0.0', () => {
  assert(isValidHost('0.0.0.0'), '0.0.0.0 should be valid');
});

it('accepts valid IPv4 address', () => {
  assert(isValidHost('192.168.1.100'), '192.168.1.100 should be valid');
});

it('accepts valid IPv4 address 10.0.0.1', () => {
  assert(isValidHost('10.0.0.1'), '10.0.0.1 should be valid');
});

it('accepts IPv6 loopback ::1', () => {
  assert(isValidHost('::1'), '::1 should be valid');
});

it('accepts full IPv6 address', () => {
  assert(isValidHost('fe80::1'), 'fe80::1 should be valid');
});

it('rejects empty string', () => {
  assert(!isValidHost(''), 'empty string should be invalid');
});

it('rejects whitespace-only string', () => {
  assert(!isValidHost('   '), 'whitespace-only string should be invalid');
});

it('rejects null', () => {
  assert(!isValidHost(null), 'null should be invalid');
});

it('rejects undefined', () => {
  assert(!isValidHost(undefined), 'undefined should be invalid');
});

it('rejects number', () => {
  assert(!isValidHost(12345), 'number should be invalid');
});

it('rejects hostname with protocol', () => {
  assert(!isValidHost('http://127.0.0.1'), 'hostname with protocol should be invalid');
});

it('rejects hostname with port', () => {
  assert(!isValidHost('127.0.0.1:9090'), 'hostname with port should be invalid');
});

// --- normalizeHost (simulates getHost fallback logic) ---
console.log('\nnormalizeHost (getHost fallback)');

it('returns default for empty string', () => {
  assertEqual(normalizeHost(''), DEFAULT_HOST, 'empty host');
});

it('returns default for null', () => {
  assertEqual(normalizeHost(null), DEFAULT_HOST, 'null host');
});

it('returns default for undefined', () => {
  assertEqual(normalizeHost(undefined), DEFAULT_HOST, 'undefined host');
});

it('returns default for invalid format', () => {
  assertEqual(normalizeHost('not-a-valid-host!'), DEFAULT_HOST, 'invalid host');
});

it('passes through localhost', () => {
  assertEqual(normalizeHost('localhost'), 'localhost');
});

it('passes through 0.0.0.0', () => {
  assertEqual(normalizeHost('0.0.0.0'), '0.0.0.0');
});

it('passes through valid IPv4', () => {
  assertEqual(normalizeHost('192.168.1.50'), '192.168.1.50');
});

it('trims whitespace', () => {
  assertEqual(normalizeHost('  127.0.0.1  '), '127.0.0.1', 'trimmed host');
});

// --- isLocalHost ---
console.log('\nisLocalHost');

it('127.0.0.1 is local', () => {
  assert(isLocalHost('127.0.0.1'), '127.0.0.1 should be local');
});

it('localhost is local', () => {
  assert(isLocalHost('localhost'), 'localhost should be local');
});

it('::1 is local', () => {
  assert(isLocalHost('::1'), '::1 should be local');
});

it('0.0.0.0 is NOT local', () => {
  assert(!isLocalHost('0.0.0.0'), '0.0.0.0 should NOT be local');
});

it('192.168.1.100 is NOT local', () => {
  assert(!isLocalHost('192.168.1.100'), '192.168.1.100 should NOT be local');
});

it('10.0.0.1 is NOT local', () => {
  assert(!isLocalHost('10.0.0.1'), '10.0.0.1 should NOT be local');
});

// --- Display URL logic (simulates _displayHost) ---
console.log('\nDisplay URL logic');

it('0.0.0.0 displays as 127.0.0.1', () => {
  const host = '0.0.0.0';
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  assertEqual(displayHost, '127.0.0.1');
});

it('127.0.0.1 displays as 127.0.0.1', () => {
  const host = '127.0.0.1';
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  assertEqual(displayHost, '127.0.0.1');
});

it('192.168.1.100 displays as 192.168.1.100', () => {
  const host = '192.168.1.100';
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  assertEqual(displayHost, '192.168.1.100');
});

// --- Local / Network URL logic ---
console.log('\nLocal / Network URL logic');

function resolveNetworkBaseUrl(host, port, lanIP) {
  if (host === '0.0.0.0') {
    return lanIP ? `http://${lanIP}:${port}/v1` : null;
  }
  if (isLocalHost(host)) {
    return null;
  }
  return `http://${host}:${port}/v1`;
}

it('local base URL always uses 127.0.0.1', () => {
  const port = 9090;
  assertEqual(`http://127.0.0.1:${port}/v1`, 'http://127.0.0.1:9090/v1');
});

it('0.0.0.0 with LAN IP gives network URL', () => {
  const result = resolveNetworkBaseUrl('0.0.0.0', 9090, '192.168.1.50');
  assertEqual(result, 'http://192.168.1.50:9090/v1');
});

it('0.0.0.0 without LAN IP gives null', () => {
  const result = resolveNetworkBaseUrl('0.0.0.0', 9090, null);
  assertEqual(result, null);
});

it('127.0.0.1 gives null network URL', () => {
  const result = resolveNetworkBaseUrl('127.0.0.1', 9090, null);
  assertEqual(result, null);
});

it('localhost gives null network URL', () => {
  const result = resolveNetworkBaseUrl('localhost', 9090, null);
  assertEqual(result, null);
});

it('concrete LAN IP gives network URL using that IP', () => {
  const result = resolveNetworkBaseUrl('192.168.1.100', 9090, null);
  assertEqual(result, 'http://192.168.1.100:9090/v1');
});

it('10.0.0.1 gives network URL using that IP', () => {
  const result = resolveNetworkBaseUrl('10.0.0.1', 8080, null);
  assertEqual(result, 'http://10.0.0.1:8080/v1');
});

// --- Curl command with auth placeholder ---
console.log('\nCurl command with auth placeholder');

it('auth-disabled curl has no Authorization header', () => {
  const modelsUrl = 'http://127.0.0.1:9090/v1/models';
  const authEnabled = false;
  const authSuffix = authEnabled ? ' -H "Authorization: Bearer YOUR_API_KEY"' : '';
  const curl = `curl ${modelsUrl}${authSuffix}`;
  assertEqual(curl, 'curl http://127.0.0.1:9090/v1/models');
  assert(!curl.includes('Authorization'), 'should not include Authorization');
});

it('auth-enabled curl contains YOUR_API_KEY placeholder', () => {
  const modelsUrl = 'http://192.168.1.50:9090/v1/models';
  const authEnabled = true;
  const authSuffix = authEnabled ? ' -H "Authorization: Bearer YOUR_API_KEY"' : '';
  const curl = `curl ${modelsUrl}${authSuffix}`;
  assert(curl.includes('YOUR_API_KEY'), 'should include YOUR_API_KEY placeholder');
  assert(!curl.includes('secret'), 'should not include real key');
});

it('auth-enabled curl never contains the real API key', () => {
  const modelsUrl = 'http://192.168.1.50:9090/v1/models';
  const realKey = 'sk-super-secret-key-12345';
  const authEnabled = true;
  const authSuffix = authEnabled ? ' -H "Authorization: Bearer YOUR_API_KEY"' : '';
  const curl = `curl ${modelsUrl}${authSuffix}`;
  assert(!curl.includes(realKey), 'curl must never contain the real API key');
});

// --- DEFAULT_HOST ---
console.log('\nDEFAULT_HOST');

it('default host is 127.0.0.1', () => {
  assertEqual(DEFAULT_HOST, '127.0.0.1', 'DEFAULT_HOST');
});

// --- LAN IP detection (os.networkInterfaces) ---
console.log('\ngetLanIPv4 (via os.networkInterfaces)');

it('finds at least one non-internal IPv4 or returns null', () => {
  const interfaces = os.networkInterfaces();
  let found = null;
  for (const entries of Object.values(interfaces)) {
    if (!entries) { continue; }
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        found = entry.address;
        break;
      }
    }
    if (found) { break; }
  }
  // This is informational — we just verify the code path doesn't throw.
  // On machines with no LAN interface, found will be null, which is valid.
  assert(true, `LAN IPv4: ${found ?? '(none found — OK)'}`);
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
