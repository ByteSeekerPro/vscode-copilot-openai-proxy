#!/usr/bin/env node
// scripts/test-auth.mjs
import crypto from 'node:crypto';
//
// Unit tests for API-key authentication logic.
// These tests validate the pure functions without requiring VS Code or a running server.
//
// Usage:
//   node scripts/test-auth.mjs

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
// Replicate the auth validation logic from src/auth.ts for standalone testing.
// The source of truth is src/auth.ts; these tests verify the behavior.
// ---------------------------------------------------------------------------

function timingSafeCompare(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(bufA.length, 0);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function validateAuth(req, requireApiKey, apiKey) {
  if (!requireApiKey) {
    return { ok: true };
  }

  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: {
        error: {
          message: 'API-key authentication is enabled but no API key is configured.',
          type: 'server_error',
          code: 'api_key_not_configured',
        },
      },
    };
  }

  const authHeader = req.headers?.authorization;

  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Missing Authorization header. Use Authorization: Bearer <apiKey>.',
          type: 'authentication_error',
          code: 'missing_authorization',
        },
      },
    };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Invalid Authorization scheme. Use Authorization: Bearer <apiKey>.',
          type: 'authentication_error',
          code: 'invalid_authorization_scheme',
        },
      },
    };
  }

  const receivedToken = authHeader.slice(7);

  if (!timingSafeCompare(receivedToken, apiKey)) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Invalid API key.',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      },
    };
  }

  return { ok: true };
}

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n  API-Key Authentication Tests\n');

// --- A. Default behavior (requireApiKey=false) ---
console.log('A. Default behavior (requireApiKey=false)');

it('allows /v1/models without Authorization header', () => {
  const result = validateAuth(makeReq(undefined), false, '');
  assert(result.ok === true, 'should be ok');
});

it('allows /v1/models with Authorization header (ignored)', () => {
  const result = validateAuth(makeReq('Bearer anything'), false, '');
  assert(result.ok === true, 'should be ok');
});

it('allows /v1/chat/completions without Authorization header', () => {
  const result = validateAuth(makeReq(undefined), false, 'somekey');
  assert(result.ok === true, 'should be ok');
});

// --- B. Auth enabled but missing apiKey ---
console.log('\nB. Auth enabled but missing apiKey');

it('returns error code api_key_not_configured', () => {
  const result = validateAuth(makeReq(undefined), true, '');
  assert(result.ok === false, 'should not be ok');
  assertEqual(result.status, 503, 'status');
  assertEqual(result.error.error.code, 'api_key_not_configured', 'code');
});

it('returns error code api_key_not_configured even with Authorization header', () => {
  const result = validateAuth(makeReq('Bearer sometoken'), true, '');
  assert(result.ok === false, 'should not be ok');
  assertEqual(result.error.error.code, 'api_key_not_configured', 'code');
});

it('error type is server_error', () => {
  const result = validateAuth(makeReq(undefined), true, '');
  assertEqual(result.error.error.type, 'server_error', 'type');
});

// --- C. Missing Authorization header ---
console.log('\nC. Missing Authorization header');

it('returns HTTP 401', () => {
  const result = validateAuth(makeReq(undefined), true, 'my-secret-key');
  assertEqual(result.status, 401, 'status');
});

it('returns error code missing_authorization', () => {
  const result = validateAuth(makeReq(undefined), true, 'my-secret-key');
  assertEqual(result.error.error.code, 'missing_authorization', 'code');
});

it('returns error type authentication_error', () => {
  const result = validateAuth(makeReq(undefined), true, 'my-secret-key');
  assertEqual(result.error.error.type, 'authentication_error', 'type');
});

// --- D. Invalid scheme ---
console.log('\nD. Invalid Authorization scheme');

it('returns HTTP 401 for Basic scheme', () => {
  const result = validateAuth(makeReq('Basic abc123'), true, 'my-secret-key');
  assertEqual(result.status, 401, 'status');
});

it('returns error code invalid_authorization_scheme for Basic', () => {
  const result = validateAuth(makeReq('Basic abc123'), true, 'my-secret-key');
  assertEqual(result.error.error.code, 'invalid_authorization_scheme', 'code');
});

it('returns HTTP 401 for custom scheme', () => {
  const result = validateAuth(makeReq('Token abc123'), true, 'my-secret-key');
  assertEqual(result.status, 401, 'status');
});

it('returns error code invalid_authorization_scheme for custom scheme', () => {
  const result = validateAuth(makeReq('Token abc123'), true, 'my-secret-key');
  assertEqual(result.error.error.code, 'invalid_authorization_scheme', 'code');
});

// --- E. Invalid Bearer token ---
console.log('\nE. Invalid Bearer token');

it('returns HTTP 401 for wrong token', () => {
  const result = validateAuth(makeReq('Bearer WRONG'), true, 'my-secret-key');
  assertEqual(result.status, 401, 'status');
});

it('returns error code invalid_api_key', () => {
  const result = validateAuth(makeReq('Bearer WRONG'), true, 'my-secret-key');
  assertEqual(result.error.error.code, 'invalid_api_key', 'code');
});

it('returns error type authentication_error', () => {
  const result = validateAuth(makeReq('Bearer WRONG'), true, 'my-secret-key');
  assertEqual(result.error.error.type, 'authentication_error', 'type');
});

it('rejects empty Bearer token', () => {
  const result = validateAuth(makeReq('Bearer '), true, 'my-secret-key');
  assert(result.ok === false, 'should not be ok');
  assertEqual(result.error.error.code, 'invalid_api_key', 'code');
});

it('rejects token with extra whitespace', () => {
  const result = validateAuth(makeReq('Bearer my-secret-key '), true, 'my-secret-key');
  assert(result.ok === false, 'should not be ok');
  assertEqual(result.error.error.code, 'invalid_api_key', 'code');
});

// --- F. Valid Bearer token ---
console.log('\nF. Valid Bearer token');

it('allows request with correct token', () => {
  const result = validateAuth(makeReq('Bearer my-secret-key'), true, 'my-secret-key');
  assert(result.ok === true, 'should be ok');
});

it('allows request with long token', () => {
  const longKey = 'a'.repeat(256);
  const result = validateAuth(makeReq(`Bearer ${longKey}`), true, longKey);
  assert(result.ok === true, 'should be ok');
});

it('allows request with special characters in key', () => {
  const specialKey = 'key-with_special.chars/123+==';
  const result = validateAuth(makeReq(`Bearer ${specialKey}`), true, specialKey);
  assert(result.ok === true, 'should be ok');
});

// --- G. Authorization header is not logged ---
console.log('\nG. Authorization header not in error responses');

it('missing_authorization error does not contain received token', () => {
  const result = validateAuth(makeReq(undefined), true, 'my-secret-key');
  const errorStr = JSON.stringify(result.error);
  assert(!errorStr.includes('my-secret-key'), 'error should not contain configured key');
});

it('invalid_api_key error does not contain received token', () => {
  const result = validateAuth(makeReq('Bearer WRONG_TOKEN'), true, 'my-secret-key');
  const errorStr = JSON.stringify(result.error);
  assert(!errorStr.includes('WRONG_TOKEN'), 'error should not contain received token');
  assert(!errorStr.includes('my-secret-key'), 'error should not contain configured key');
});

it('invalid_authorization_scheme error does not contain header value', () => {
  const result = validateAuth(makeReq('Basic secretvalue'), true, 'my-secret-key');
  const errorStr = JSON.stringify(result.error);
  assert(!errorStr.includes('secretvalue'), 'error should not contain header value');
});

it('api_key_not_configured error does not contain header value', () => {
  const result = validateAuth(makeReq('Bearer sometoken'), true, '');
  const errorStr = JSON.stringify(result.error);
  assert(!errorStr.includes('sometoken'), 'error should not contain received token');
});

// --- H. timingSafeCompare ---
console.log('\nH. timingSafeCompare');

it('returns true for identical strings', () => {
  assert(timingSafeCompare('abc', 'abc') === true, 'should match');
});

it('returns false for different strings', () => {
  assert(timingSafeCompare('abc', 'def') === false, 'should not match');
});

it('returns false for different lengths', () => {
  assert(timingSafeCompare('abc', 'abcd') === false, 'should not match');
});

it('returns false for empty vs non-empty', () => {
  assert(timingSafeCompare('', 'a') === false, 'should not match');
});

it('returns true for two empty strings', () => {
  assert(timingSafeCompare('', '') === true, 'should match');
});

// --- I. isLocalHost helper (for non-local warning logic) ---
console.log('\nI. Non-local host warning logic');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
function isLocalHost(host) {
  return LOCAL_HOSTS.has(host);
}

it('127.0.0.1 is local', () => {
  assert(isLocalHost('127.0.0.1'), 'should be local');
});

it('0.0.0.0 is NOT local (should trigger warning when auth disabled)', () => {
  assert(!isLocalHost('0.0.0.0'), 'should not be local');
});

it('192.168.1.100 is NOT local (should trigger warning when auth disabled)', () => {
  assert(!isLocalHost('192.168.1.100'), 'should not be local');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passing, ${failed} failing\n`);

if (failed > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(f);
  }
  process.exit(1);
}
