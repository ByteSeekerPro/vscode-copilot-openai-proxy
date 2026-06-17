#!/usr/bin/env node
// scripts/test-compat.mjs
//
// OpenAI-compatible API compatibility tests for the local proxy server.
//
// Prerequisites:
//   The extension/server must be running on the configured port.
//
// Usage:
//   node scripts/test-compat.mjs          # uses default port 9090
//   set PROXY_PORT=8080 && node scripts/test-compat.mjs
//   set PROXY_API_KEY=YOUR_KEY && node scripts/test-compat.mjs
//   set PROXY_HOST=192.168.x.x && set PROXY_API_KEY=YOUR_KEY && node scripts/test-compat.mjs
//
// Exit code 0 = all tests passed, 1 = at least one failure.

const BASE_PORT = process.env.PROXY_PORT || 9090;
const BASE_HOST = process.env.PROXY_HOST || '127.0.0.1';
const BASE_URL = `http://${BASE_HOST}:${BASE_PORT}`;
const TIMEOUT_MS = 15_000;
const API_KEY = process.env.PROXY_API_KEY || '';

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describe(name, fn) {
  console.log(`\n  ${name}`);
  return fn();
}

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`    ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = `    ✗ ${name} — ${err.message}`;
    console.log(msg);
    failures.push(msg);
  }
}

/** Assert that condition is truthy. */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/** Assert that value equals expected. */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Assert that value is a string of length > 0. */
function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: expected a non-empty string, got ${JSON.stringify(value)}`);
  }
}

/** Build common headers, merging caller headers with auth if present. */
function buildHeaders(extra = {}) {
  const headers = { ...extra };
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

/** Fetch with timeout. Applies auth header when PROXY_API_KEY is set. */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mergedOptions = {
    ...options,
    headers: buildHeaders(options.headers || {}),
    signal: controller.signal,
  };
  try {
    return await fetch(url, mergedOptions);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Server reachability check
// ---------------------------------------------------------------------------

async function checkServerReachable() {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/v1/models`, { method: 'GET' }, 5000);
    if (res.ok || res.status === 500) {
      // 500 means server is running but LM bridge may not be ready — still reachable
      return true;
    }
    if (res.status === 401 || res.status === 403) {
      // Server is reachable, but auth failed — still reachable
      return true;
    }
  } catch {
    // Connection refused or timeout
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function testModelsEndpoint() {
  describe('A. GET /v1/models', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/v1/models`);
    const status = res.status;
    const contentType = res.headers.get('content-type') || '';

    it('returns HTTP 200', () => {
      assertEqual(status, 200, 'status');
    });

    it('returns JSON content type', () => {
      assert(
        contentType.includes('application/json'),
        `content-type should include application/json, got "${contentType}"`
      );
    });

    let body;
    try {
      body = JSON.parse(res._rawBody);
    } catch {
      body = null;
    }

    it('response body is valid JSON', () => {
      assert(body !== null, 'Response body could not be parsed as JSON');
    });

    it('has "object" equal to "list"', () => {
      assertEqual(body.object, 'list', 'object');
    });

    it('has "data" as an array', () => {
      assert(Array.isArray(body.data), `data should be an array, got ${typeof body.data}`);
    });

    it('each model entry has required fields', () => {
      for (const model of body.data) {
        assertNonEmptyString(model.id, 'model.id');
        assertEqual(model.object, 'model', 'model.object');
        assert(typeof model.owned_by !== 'undefined', 'model.owned_by should be defined');
      }
    });
  });
}

async function testChatCompletionsNonStreaming() {
  describe('B. POST /v1/chat/completions (non-streaming)', async () => {
    // Fetch available models first
    let modelId = 'gpt-4o'; // fallback
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback model name
    }

    const requestBody = {
      model: modelId,
      messages: [{ role: 'user', content: 'Say exactly: test ok' }],
      stream: false,
    };

    const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const status = res.status;
    const contentType = res.headers.get('content-type') || '';

    it('returns HTTP 200', () => {
      assertEqual(status, 200, 'status');
    });

    it('returns JSON content type', () => {
      assert(
        contentType.includes('application/json'),
        `content-type should include application/json, got "${contentType}"`
      );
    });

    let body;
    try {
      body = JSON.parse(res._rawBody);
    } catch {
      body = null;
    }

    it('response body is valid JSON', () => {
      assert(body !== null, 'Response body could not be parsed as JSON');
    });

    it('has "id" field', () => {
      assertNonEmptyString(body.id, 'id');
    });

    it('has "object" equal to "chat.completion"', () => {
      assertEqual(body.object, 'chat.completion', 'object');
    });

    it('has "created" field (numeric)', () => {
      assert(typeof body.created === 'number', `created should be a number, got ${typeof body.created}`);
    });

    it('has "model" field', () => {
      assertNonEmptyString(body.model, 'model');
    });

    it('has "choices" array with at least one entry', () => {
      assert(Array.isArray(body.choices), 'choices should be an array');
      assert(body.choices.length > 0, 'choices should have at least one entry');
    });

    it('first choice has message with role "assistant"', () => {
      const choice = body.choices[0];
      assert(choice.message !== undefined, 'choices[0].message should be defined');
      assertEqual(choice.message.role, 'assistant', 'message.role');
    });

    it('first choice message has content', () => {
      const choice = body.choices[0];
      assert(typeof choice.message.content === 'string', 'message.content should be a string');
    });

    it('has "usage" object (optional but expected)', () => {
      // Presence of usage is expected per OpenAI format. If absent, warn but don't fail.
      if (body.usage) {
        assert(typeof body.usage === 'object', 'usage should be an object');
      } else {
        console.log('      (usage not present — non-fatal)');
      }
    });
  });
}

async function testChatCompletionsStreaming() {
  describe('C. POST /v1/chat/completions (streaming)', async () => {
    // Fetch available models first
    let modelId = 'gpt-4o'; // fallback
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback model name
    }

    const requestBody = {
      model: modelId,
      messages: [{ role: 'user', content: 'Say exactly: stream test ok' }],
      stream: true,
    };

    const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const status = res.status;
    const contentType = res.headers.get('content-type') || '';

    it('returns HTTP 200', () => {
      assertEqual(status, 200, 'status');
    });

    it('returns text/event-stream content type', () => {
      assert(
        contentType.includes('text/event-stream'),
        `content-type should include text/event-stream, got "${contentType}"`
      );
    });

    // Read the full response body as text
    const rawText = res._rawBody;

    it('stream contains "data:" chunks', () => {
      assert(
        rawText.includes('data:'),
        'Stream body should contain "data:" prefixed lines'
      );
    });

    it('stream eventually contains "[DONE]"', () => {
      assert(
        rawText.includes('[DONE]'),
        'Stream body should contain "[DONE]" sentinel'
      );
    });

    it('data chunks are parseable as JSON with chat.completion.chunk shape', () => {
      const lines = rawText.split('\n');
      let parsedCount = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6); // remove "data: " prefix
        if (payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload);
          if (chunk.object === 'chat.completion.chunk') {
            parsedCount++;
            assert(Array.isArray(chunk.choices), 'chunk.choices should be an array');
          }
        } catch {
          // Non-JSON data lines may exist; skip
        }
      }
      assert(parsedCount > 0, 'Should have at least one parseable chat.completion.chunk');
    });
  });
}

async function testInvalidRequests() {
  describe('D. Invalid request behavior', async () => {
    // D1: Missing model
    it('POST /v1/chat/completions with missing "model" returns error', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert(!res.ok || res.status >= 400, `Expected non-2xx, got ${res.status}`);
    });

    // D2: Missing messages
    it('POST /v1/chat/completions with missing "messages" returns error', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      assert(!res.ok || res.status >= 400, `Expected non-2xx, got ${res.status}`);
    });

    // D3: Empty body
    it('POST /v1/chat/completions with empty body returns error', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });
      assert(!res.ok || res.status >= 400, `Expected non-2xx, got ${res.status}`);
    });

    // D4: Unknown endpoint
    it('GET /v1/nonexistent returns non-2xx', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/nonexistent`);
      assert(!res.ok || res.status >= 400, `Expected non-2xx, got ${res.status}`);
    });

    // D5: Server should still be reachable after invalid requests
    it('Server still reachable after invalid requests', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  });
}

async function testCallHistoryCompatibility() {
  describe('E. Call history compatibility', async () => {
    // Make a simple call, then verify the API still returns OpenAI-compatible responses
    let modelId = 'gpt-4o'; // fallback
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    // Call 1: non-streaming
    const res1 = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say: history test 1' }],
        stream: false,
      }),
    });

    it('first call returns OpenAI-compatible response', () => {
      assertEqual(res1.status, 200, 'status');
      const body = JSON.parse(res1._rawBody);
      assertEqual(body.object, 'chat.completion', 'object');
      assert(Array.isArray(body.choices), 'choices is array');
    });

    // Call 2: verify subsequent call still works (call history doesn't break compat)
    const res2 = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say: history test 2' }],
        stream: false,
      }),
    });

    it('subsequent call still returns OpenAI-compatible response', () => {
      assertEqual(res2.status, 200, 'status');
      const body = JSON.parse(res2._rawBody);
      assertEqual(body.object, 'chat.completion', 'object');
      assert(Array.isArray(body.choices), 'choices is array');
      assertNonEmptyString(body.id, 'id');
    });

    // Call 3: streaming call after non-streaming calls
    const res3 = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say: history test 3' }],
        stream: true,
      }),
    });

    it('streaming call after non-streaming calls still works', () => {
      assertEqual(res3.status, 200, 'status');
      assert(
        (res3.headers.get('content-type') || '').includes('text/event-stream'),
        'content-type should be text/event-stream'
      );
      assert(res3._rawBody.includes('[DONE]'), 'stream should end with [DONE]');
    });
  });
}

// ---------------------------------------------------------------------------
// Message content normalization tests (F)
// ---------------------------------------------------------------------------
// These tests validate that the proxy correctly normalizes OpenAI-style
// message content shapes (string, array of parts, tool results) and returns
// HTTP 400 for unsupported content types instead of 500.
//
// NOTE: Tests F1–F4 require a running server with an active VS Code LM model
// to verify the full round-trip. Tests F5–F7 only need the server to respond
// with an HTTP status code.

async function testMessageContentNormalization() {
  describe('F. Message content normalization', async () => {
    // Resolve a model ID for live round-trip tests
    let modelId = 'gpt-4o';
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    // F1: Plain string content
    it('F1: string content returns 200', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'F1 status');
    });

    // F2: Array with type "text"
    it('F2: array content with type "text" returns 200', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Reply with the word OK.' }],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'F2 status');
    });

    // F3: Array with type "input_text"
    it('F3: array content with type "input_text" returns 200', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'Reply with the word OK.' }],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'F3 status');
    });

    // F4: Tool role message does not crash
    it('F4: tool role message does not crash (returns 200 or model error)', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'What time is it?' },
            {
              role: 'tool',
              tool_call_id: 'call_123',
              content: 'The current time is 12:00 UTC.',
            },
          ],
          stream: false,
        }),
      });
      // Should not be 500 — either 200 (model handled it) or 400 (validation)
      assert(res.status !== 500, `F4: expected non-500, got ${res.status}`);
    });

    // F5: image_url content returns 400 (model without image support) or
    //      400 (remote URL not supported) — both are acceptable non-500 results.
    //      If the model supports images and the URL were a valid data URL, 200
    //      would also be acceptable.
    it('F5: image_url content returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image?' },
                { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
              ],
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `F5: expected non-500, got ${res.status}`);
    });

    // F6: Unknown content part type returns 400, not 500
    it('F6: unknown content part type returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [{ type: 'audio', data: 'base64encoded' }],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'F6 status');
    });

    // F7: Malformed content (number instead of string/array) returns 400
    it('F7: malformed content returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: 42,
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'F7 status');
    });

    // F8: Zoo Code style request (content parts array) returns 200
    it('F8: Zoo Code style array content returns 200', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Reply with the word OK.',
                },
              ],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'F8 status');
    });
  });
}

// ---------------------------------------------------------------------------
// Zoo Code / OpenAI Agent compatibility tests (G)
// ---------------------------------------------------------------------------
// These tests validate that the proxy handles agent-style payloads:
// role:tool, assistant with tool_calls, tools, tool_choice, and
// that unsupported content returns clean 400 errors with OpenAI shape.

async function testAgentCompatibility() {
  describe('G. Zoo Code / OpenAI Agent compatibility', async () => {
    // Resolve a model ID
    let modelId = 'gpt-4o';
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    // G1: role:tool message does not crash
    it('G1: role:tool message returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'What is the weather?' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_001',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"Berlin"}' },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: 'call_001',
              content: 'Sunny, 22°C',
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `G1: expected non-500, got ${res.status}`);
    });

    // G2: assistant message with tool_calls (content:null) does not crash
    it('G2: assistant with tool_calls content:null returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'Do something' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_002',
                  type: 'function',
                  function: { name: 'example_tool', arguments: '{}' },
                },
              ],
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `G2: expected non-500, got ${res.status}`);
    });

    // G3: request with tools field does not crash
    it('G3: request with tools field returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `G3: expected non-500, got ${res.status}`);
    });

    // G4: request with tool_choice:auto does not crash
    it('G4: request with tool_choice:auto returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'auto',
          stream: false,
        }),
      });
      assert(res.status !== 500, `G4: expected non-500, got ${res.status}`);
    });

    // G5: request with tool_choice:required function does not crash
    it('G5: request with tool_choice function returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: {
            type: 'function',
            function: { name: 'example' },
          },
          stream: false,
        }),
      });
      assert(res.status !== 500, `G5: expected non-500, got ${res.status}`);
    });

    // G6: image_url with remote URL returns 400 with OpenAI error shape
    // (remote URLs are not yet supported regardless of model capability)
    it('G6: remote image_url returns 400 with OpenAI error shape', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'G6 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'G6: response should have error field');
      assert(typeof body.error.message === 'string', 'G6: error.message should be string');
      assertEqual(body.error.type, 'invalid_request_error', 'G6: error.type');
      // Verify no base64 data leaked into the error message
      assert(!body.error.message.includes('base64'), 'G6: error should not contain base64 data');
    });

    // G7: unknown content part returns 400 with OpenAI error shape
    it('G7: unknown content part returns 400 with OpenAI error shape', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [{ type: 'file', data: 'base64data' }],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'G7 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'G7: response should have error field');
      assert(typeof body.error.message === 'string', 'G7: error.message should be string');
    });

    // G8: malformed content returns 400
    it('G8: malformed content (number) returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 42 }],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'G8 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'G8: response should have error field');
    });

    // G9: 500 errors have OpenAI error shape (not raw string)
    it('G9: upstream errors have OpenAI error shape', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nonexistent-model-xyz-999',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      });
      // This may be 200 (model falls back to default) or 500 (model not found).
      // If 500, verify the shape is OpenAI-compatible.
      if (res.status === 500) {
        const body = JSON.parse(res._rawBody);
        assert(body.error !== undefined, 'G9: 500 response should have error field');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Image input compatibility tests (H)
// ---------------------------------------------------------------------------
// These tests validate that the proxy correctly handles OpenAI-compatible
// image content parts (image_url with data URLs and remote URLs).
//
// A 1x1 transparent PNG is used as a minimal test image.
// Base64 data is never printed in failure output.

/** Tiny 1x1 transparent PNG as a data URL. */
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function testImageInputCompatibility() {
  describe('H. Image input compatibility', async () => {
    // Resolve model ID — try gpt-5-mini first (known image-capable), then first available
    let modelId = 'gpt-5-mini';
    let imageCapableModelId = null;
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        // Use gpt-5-mini if available, otherwise first model
        const found = modelsBody.data.find(m => m.id === 'gpt-5-mini');
        if (found) {
          imageCapableModelId = 'gpt-5-mini';
        }
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    // H1: Data URL image with an image-capable model returns non-500
    //      (should be 200 if model supports images and VS Code LM accepts it)
    it('H1: data URL image with image-capable model returns non-500', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image? Answer briefly.' },
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          stream: false,
        }),
      });
      // Should not be a proxy-side 500. Could be 200 (accepted), 400 (model
      // doesn't support images), or a VS Code LM API error.
      assert(res.status !== 500, `H1: expected non-500, got ${res.status}`);
    });

    // H2: If the request succeeds (200), verify OpenAI-compatible response shape
    it('H2: successful image request has OpenAI response shape', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this image briefly.' },
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          stream: false,
        }),
      });
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'H2 object');
        assert(Array.isArray(body.choices), 'H2: choices should be array');
        assert(body.choices.length > 0, 'H2: choices should not be empty');
        assertEqual(body.choices[0].message.role, 'assistant', 'H2: role');
        assert(typeof body.choices[0].message.content === 'string', 'H2: content is string');
      } else {
        // Non-200 is acceptable if model doesn't support images
        console.log(`      (H2: skipped — model returned ${res.status})`);
        skipped++;
      }
    });

    // H3: Remote HTTP image URL returns 400 (not yet supported)
    it('H3: remote HTTP image URL returns 400', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this.' },
                { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
              ],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'H3 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'H3: should have error field');
      assert(body.error.message.toLowerCase().includes('remote') ||
             body.error.message.toLowerCase().includes('not yet supported') ||
             body.error.message.toLowerCase().includes('data url'),
        'H3: error should mention remote URLs not supported');
    });

    // H4: Invalid data URL returns 400
    it('H4: invalid data URL returns 400', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: 'data:not-valid' } },
              ],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'H4 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'H4: should have error field');
      assert(typeof body.error.message === 'string', 'H4: error.message should be string');
    });

    // H5: Unsupported MIME type returns 400
    it('H5: unsupported MIME type returns 400', async () => {
      const targetModel = imageCapableModelId || modelId;
      // Fake a "data:image/svg+xml;base64,..." URL
      const fakeSvg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: fakeSvg } },
              ],
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'H5 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'H5: should have error field');
      assert(body.error.message.toLowerCase().includes('mime') ||
             body.error.message.toLowerCase().includes('unsupported'),
        'H5: error should mention unsupported MIME type');
    });

    // H6: Model without image support returns 400 with clear message
    it('H6: model without image support returns 400', async () => {
      // Use a deliberately nonexistent model ID — it will fall back to the
      // default model which may or may not support images.
      // The key test: if it returns 400, the error shape must be correct.
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text-only-model-no-images',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          stream: false,
        }),
      });
      // If the model falls back to one that supports images, it might be 200.
      // If the model doesn't support images, it should be 400.
      assert(res.status !== 500, `H6: expected non-500, got ${res.status}`);
      if (res.status === 400) {
        const body = JSON.parse(res._rawBody);
        assert(body.error !== undefined, 'H6: should have error field');
        assertEqual(body.error.type, 'invalid_request_error', 'H6: error.type');
      }
    });

    // H7: Base64 data is not leaked in any error message
    it('H7: base64 image data not leaked in error messages', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          stream: false,
        }),
      });
      if (res.status >= 400) {
        const body = JSON.parse(res._rawBody);
        if (body.error && typeof body.error.message === 'string') {
          // The actual base64 payload should never appear in the error
          const base64Payload = TINY_PNG_DATA_URL.split('base64,')[1];
          assert(
            !body.error.message.includes(base64Payload),
            'H7: error message should not contain base64 image data'
          );
        }
      }
      // If 200, no error to check — pass
    });

    // H8: Text-only request still works after image handling is added
    it('H8: text-only request still works after image support', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'H8 status');
      const body = JSON.parse(res._rawBody);
      assertEqual(body.object, 'chat.completion', 'H8 object');
    });

    // H9: Mixed text + image content part with input_image type
    it('H9: input_image content part type returns non-500', async () => {
      const targetModel = imageCapableModelId || modelId;
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this.' },
                { type: 'input_image', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `H9: expected non-500, got ${res.status}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Tool diagnostics and validation tests (I)
// ---------------------------------------------------------------------------
// These tests validate the proxy's handling of OpenAI tools/tool_choice
// including validation, classification, response hardening, and diagnostics.

async function testToolDiagnosticsAndValidation() {
  describe('I. Tool diagnostics and validation', async () => {
    // Resolve a model ID
    let modelId = 'gpt-4o';
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    // I1: Valid tools are accepted (returns non-500)
    it('I1: valid tools array is accepted', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_time',
                description: 'Return the current time.',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
              },
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `I1: expected non-500, got ${res.status}`);
    });

    // I2: Malformed tool (missing type) returns 400 with OpenAI error shape
    it('I2: tool missing type returns 400 invalid_request_error', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              function: { name: 'get_time', description: 'Return the current time.' },
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'I2 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'I2: should have error field');
      assertEqual(body.error.type, 'invalid_request_error', 'I2: error.type');
      assertEqual(body.error.code, 'invalid_tools', 'I2: error.code');
      assert(body.error.param === 'tools', 'I2: error.param should be "tools"');
    });

    // I3: Tool with empty name returns 400
    it('I3: tool with empty function.name returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: { name: '', description: 'Empty name.' },
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'I3 status');
      const body = JSON.parse(res._rawBody);
      assert(body.error !== undefined, 'I3: should have error field');
      assertEqual(body.error.code, 'invalid_tools', 'I3: error.code');
    });

    // I4: Tool with non-function type returns 400
    it('I4: tool with type !== "function" returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'retrieval',
              function: { name: 'search' },
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'I4 status');
      const body = JSON.parse(res._rawBody);
      assertEqual(body.error.code, 'invalid_tools', 'I4: error.code');
    });

    // I5: "tools" as non-array returns 400
    it('I5: tools as non-array returns 400', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: 'not_an_array',
          stream: false,
        }),
      });
      assertEqual(res.status, 400, 'I5 status');
      const body = JSON.parse(res._rawBody);
      assertEqual(body.error.code, 'invalid_tools', 'I5: error.code');
    });

    // I6: Non-streaming response always has assistant message with role
    it('I6: non-streaming response always has assistant message.role', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_time',
                description: 'Return the current time.',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'I6 status');
      const body = JSON.parse(res._rawBody);
      assert(Array.isArray(body.choices), 'I6: choices should be array');
      assert(body.choices.length > 0, 'I6: choices should not be empty');
      assert(body.choices[0].message !== undefined, 'I6: message should be defined');
      assertEqual(body.choices[0].message.role, 'assistant', 'I6: role');
      // When no tool_calls, content should be a string (even if empty)
      if (!body.choices[0].message.tool_calls) {
        assert(typeof body.choices[0].message.content === 'string', 'I6: content is string when no tool_calls');
      }
      // finish_reason should be either "stop" or "tool_calls"
      assert(
        body.choices[0].finish_reason === 'stop' || body.choices[0].finish_reason === 'tool_calls',
        `I6: finish_reason should be stop or tool_calls, got "${body.choices[0].finish_reason}"`
      );
    });

    // I7: tool_choice:auto is accepted (returns non-500)
    it('I7: tool_choice:auto is accepted', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'auto',
          stream: false,
        }),
      });
      assert(res.status !== 500, `I7: expected non-500, got ${res.status}`);
    });

    // I8: tool_choice:"required" is accepted (returns non-500 with valid shape)
    it('I8: tool_choice:required is accepted with valid response', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'required',
          stream: false,
        }),
      });
      assert(res.status !== 500, `I8: expected non-500, got ${res.status}`);
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assert(Array.isArray(body.choices), 'I8: choices should be array');
        assert(body.choices.length > 0, 'I8: choices should not be empty');
        assertEqual(body.choices[0].message.role, 'assistant', 'I8: role');
      }
    });

    // I9: tool_choice with specific function is accepted
    it('I9: tool_choice with specific function is accepted', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: 'example' } },
          stream: false,
        }),
      });
      assert(res.status !== 500, `I9: expected non-500, got ${res.status}`);
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assert(Array.isArray(body.choices), 'I9: choices should be array');
        assert(body.choices.length > 0, 'I9: choices should not be empty');
        assertEqual(body.choices[0].message.role, 'assistant', 'I9: role');
      }
    });

    // I10: When tools are present, content should be null if tool_calls exist
    it('I10: content is null when tool_calls are present', async () => {
      // We simulate this by checking the response structure when the model
      // returns tool calls. This is a structural check: if tool_calls exist,
      // content must be null per OpenAI spec.
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'example',
                description: 'An example tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          stream: false,
        }),
      });
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        const msg = body.choices[0].message;
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          assert(msg.content === null, `I10: content should be null when tool_calls present, got ${JSON.stringify(msg.content)}`);
          assertEqual(body.choices[0].finish_reason, 'tool_calls', 'I10: finish_reason');
          // Verify tool_call structure
          const tc = msg.tool_calls[0];
          assertEqual(tc.type, 'function', 'I10: tool_calls[0].type');
          assertNonEmptyString(tc.function.name, 'I10: tool_calls[0].function.name');
          assert(typeof tc.function.arguments === 'string', 'I10: tool_calls[0].function.arguments is string');
          assertNonEmptyString(tc.id, 'I10: tool_calls[0].id');
        }
        // If no tool_calls, content should be a string
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          assert(typeof msg.content === 'string', 'I10: content is string when no tool_calls');
          assertEqual(body.choices[0].finish_reason, 'stop', 'I10: finish_reason');
        }
      }
    });

    // I11: Streaming response has valid SSE structure with tool choice
    it('I11: streaming with tools returns valid SSE', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'echo',
                description: 'Echo a message',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'auto',
          stream: true,
        }),
      });
      assertEqual(res.status, 200, 'I11 status');
      const rawText = res._rawBody;
      assert(rawText.includes('data:'), 'I11: should have data: chunks');
      assert(rawText.includes('[DONE]'), 'I11: should end with [DONE]');

      // Verify the final chunk before [DONE] has a finish_reason
      const lines = rawText.split('\n').filter(l => l.trim().startsWith('data: ') && !l.includes('[DONE]'));
      let lastChunk = null;
      for (const line of lines) {
        try {
          const chunk = JSON.parse(line.trim().slice(6));
          if (chunk.choices && chunk.choices.length > 0) {
            lastChunk = chunk;
          }
        } catch {
          // skip non-JSON
        }
      }
      // The last chunk with choices should have a finish_reason
      if (lastChunk) {
        assert(
          lastChunk.choices[0].finish_reason === 'stop' || lastChunk.choices[0].finish_reason === 'tool_calls',
          `I11: last chunk finish_reason should be stop or tool_calls, got "${lastChunk.choices[0].finish_reason}"`
        );
      }
    });

    // I12: Assistant response with content:null and tool_calls in history
    it('I12: assistant with content:null + tool_calls in history returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'What time is it?' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: { name: 'get_time', arguments: '{}' },
                },
              ],
            },
            { role: 'tool', tool_call_id: 'call_abc123', content: '{"time":"12:00"}' },
            { role: 'user', content: 'Thank you. What is 2+2?' },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'calculator',
                description: 'Calculate math',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          stream: false,
        }),
      });
      assert(res.status !== 500, `I12: expected non-500, got ${res.status}`);
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'I12 object');
        assert(Array.isArray(body.choices), 'I12: choices is array');
        assert(body.choices.length > 0, 'I12: choices not empty');
        assertEqual(body.choices[0].message.role, 'assistant', 'I12: role');
      }
    });

    // I13: Streaming role delta is emitted
    it('I13: streaming response includes role delta', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
          stream: true,
        }),
      });
      assertEqual(res.status, 200, 'I13 status');
      const rawText = res._rawBody;
      const lines = rawText.split('\n').filter(l => l.trim().startsWith('data: ') && !l.includes('[DONE]'));
      let hasRoleDelta = false;
      for (const line of lines) {
        try {
          const chunk = JSON.parse(line.trim().slice(6));
          if (chunk.choices && chunk.choices.length > 0 &&
              chunk.choices[0].delta && chunk.choices[0].delta.role === 'assistant') {
            hasRoleDelta = true;
            break;
          }
        } catch {
          // skip non-JSON
        }
      }
      assert(hasRoleDelta, 'I13: streaming should include a role:"assistant" delta');
    });
  });
}

// ---------------------------------------------------------------------------
// Tool choice policy tests (J)
// ---------------------------------------------------------------------------
// These tests validate the toolChoicePolicy setting behavior.
//
// Tests adapt to the server's current policy configuration:
//   - bestEffort (default): tool_choice requests return 200 with valid response
//   - strictPreflight: tool_choice requests return 400 with tool_choice_not_enforceable
//   - strictAfterResponse: returns 400 with required_tool_call_missing if no tool_calls
//
// Each test validates the OpenAI-compatible error shape when a 400 is returned,
// or validates the valid response shape when a 200 is returned.

async function testToolChoicePolicy() {
  describe('J. Tool choice policy', async () => {
    // Resolve a model ID
    let modelId = 'gpt-4o';
    try {
      const modelsRes = await fetchWithTimeout(`${BASE_URL}/v1/models`);
      const modelsBody = JSON.parse(modelsRes._rawBody);
      if (modelsBody.data && modelsBody.data.length > 0) {
        modelId = modelsBody.data[0].id;
      }
    } catch {
      // Use fallback
    }

    const toolDefs = [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Return the current time.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    ];

    // J1: bestEffort — tool_choice:"required" returns valid response (non-500)
    it('J1: tool_choice:required returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          tools: toolDefs,
          tool_choice: 'required',
          stream: false,
        }),
      });
      // bestEffort: 200; strictPreflight: 400; both are non-500
      assert(res.status !== 500, `J1: expected non-500, got ${res.status}`);
    });

    // J2: When tool_choice:"required" returns 400, verify OpenAI error shape
    //     (strictPreflight mode)
    it('J2: tool_choice:required 400 has OpenAI error shape if strictPreflight', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          tools: toolDefs,
          tool_choice: 'required',
          stream: false,
        }),
      });
      if (res.status === 400) {
        const body = JSON.parse(res._rawBody);
        assert(body.error !== undefined, 'J2: should have error field');
        assertEqual(body.error.type, 'invalid_request_error', 'J2: error.type');
        assertEqual(body.error.param, 'tool_choice', 'J2: error.param');
        assertEqual(body.error.code, 'tool_choice_not_enforceable', 'J2: error.code');
        assertNonEmptyString(body.error.message, 'J2: error.message');
      } else {
        // bestEffort mode — request should succeed
        assertEqual(res.status, 200, 'J2 status (bestEffort)');
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'J2 object');
        assert(Array.isArray(body.choices), 'J2: choices should be array');
        assert(body.choices.length > 0, 'J2: choices should not be empty');
        assertEqual(body.choices[0].message.role, 'assistant', 'J2: role');
      }
    });

    // J3: tool_choice with specific function returns non-500
    it('J3: tool_choice:function returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Call the get_time tool.' }],
          tools: toolDefs,
          tool_choice: { type: 'function', function: { name: 'get_time' } },
          stream: false,
        }),
      });
      assert(res.status !== 500, `J3: expected non-500, got ${res.status}`);
    });

    // J4: When specific function tool_choice returns 400, verify error shape
    //     (strictPreflight mode)
    it('J4: tool_choice:function 400 has OpenAI error shape if strictPreflight', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Call the get_time tool.' }],
          tools: toolDefs,
          tool_choice: { type: 'function', function: { name: 'get_time' } },
          stream: false,
        }),
      });
      if (res.status === 400) {
        const body = JSON.parse(res._rawBody);
        assert(body.error !== undefined, 'J4: should have error field');
        assertEqual(body.error.type, 'invalid_request_error', 'J4: error.type');
        assertEqual(body.error.param, 'tool_choice', 'J4: error.param');
        assertEqual(body.error.code, 'tool_choice_not_enforceable', 'J4: error.code');
        assertNonEmptyString(body.error.message, 'J4: error.message');
      } else {
        // bestEffort mode — request should succeed
        assertEqual(res.status, 200, 'J4 status (bestEffort)');
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'J4 object');
        assert(Array.isArray(body.choices), 'J4: choices should be array');
      }
    });

    // J5: tool_choice:"auto" is never rejected by policy
    it('J5: tool_choice:auto is never rejected by policy', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: toolDefs,
          tool_choice: 'auto',
          stream: false,
        }),
      });
      // auto should never cause a policy rejection (400 with tool_choice error)
      // and should never be a 500
      assert(res.status !== 500, `J5: expected non-500, got ${res.status}`);
      // If 400, should not be a tool_choice policy error
      if (res.status === 400) {
        const body = JSON.parse(res._rawBody);
        assert(
          !(body.error && body.error.param === 'tool_choice'),
          'J5: tool_choice:auto should not be rejected with tool_choice error'
        );
      }
    });

    // J6: bestEffort — when tool_choice:"required" returns 200, verify valid response
    //     with no fake tool_calls
    it('J6: bestEffort tool_choice:required 200 has valid response, no fake tool_calls', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
          tools: toolDefs,
          tool_choice: 'required',
          stream: false,
        }),
      });
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'J6 object');
        assert(Array.isArray(body.choices), 'J6: choices should be array');
        assert(body.choices.length > 0, 'J6: choices should not be empty');
        const msg = body.choices[0].message;
        assertEqual(msg.role, 'assistant', 'J6: role');
        // Verify response shape consistency:
        // If tool_calls present, content must be null; if no tool_calls, content is string
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          assert(msg.content === null, 'J6: content should be null when tool_calls present');
          assertEqual(body.choices[0].finish_reason, 'tool_calls', 'J6: finish_reason');
          // Verify no fake tool_calls — each must have valid structure
          for (const tc of msg.tool_calls) {
            assertEqual(tc.type, 'function', 'J6: tool_call.type');
            assertNonEmptyString(tc.id, 'J6: tool_call.id');
            assertNonEmptyString(tc.function?.name, 'J6: tool_call.function.name');
          }
        } else {
          assert(typeof msg.content === 'string', 'J6: content is string when no tool_calls');
          assertEqual(body.choices[0].finish_reason, 'stop', 'J6: finish_reason');
          // No fake tool_calls injected
          assert(msg.tool_calls === undefined || msg.tool_calls === null, 'J6: no fake tool_calls');
        }
      }
    });

    // J7: Streaming with tool_choice:"required" returns non-500
    it('J7: streaming tool_choice:required returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: toolDefs,
          tool_choice: 'required',
          stream: true,
        }),
      });
      // strictPreflight: 400 JSON; bestEffort: 200 SSE
      assert(res.status !== 500, `J7: expected non-500, got ${res.status}`);
    });

    // J8: Streaming strictPreflight returns 400 JSON (not SSE)
    it('J8: streaming strictPreflight returns 400 JSON, not SSE', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: toolDefs,
          tool_choice: 'required',
          stream: true,
        }),
      });
      if (res.status === 400) {
        const contentType = res.headers.get('content-type') || '';
        // strictPreflight rejects before SSE headers, so should be JSON
        const body = JSON.parse(res._rawBody);
        assert(body.error !== undefined, 'J8: should have error field');
        assertEqual(body.error.type, 'invalid_request_error', 'J8: error.type');
        assertEqual(body.error.code, 'tool_choice_not_enforceable', 'J8: error.code');
        // Should NOT be text/event-stream
        assert(
          !contentType.includes('text/event-stream'),
          `J8: content-type should not be text/event-stream for preflight rejection, got "${contentType}"`
        );
      } else {
        // bestEffort mode — should be valid SSE
        assertEqual(res.status, 200, 'J8 status (bestEffort)');
        const contentType = res.headers.get('content-type') || '';
        assert(contentType.includes('text/event-stream'), 'J8: bestEffort should be SSE');
      }
    });

    // J9: tool_choice:none returns non-500 (never requires enforcement)
    it('J9: tool_choice:none returns non-500', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          tools: toolDefs,
          tool_choice: 'none',
          stream: false,
        }),
      });
      assert(res.status !== 500, `J9: expected non-500, got ${res.status}`);
      if (res.status === 200) {
        const body = JSON.parse(res._rawBody);
        assertEqual(body.object, 'chat.completion', 'J9 object');
      }
    });

    // J10: Existing normal chat behavior remains working (regression guard)
    it('J10: normal chat without tools still works', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          stream: false,
        }),
      });
      assertEqual(res.status, 200, 'J10 status');
      const body = JSON.parse(res._rawBody);
      assertEqual(body.object, 'chat.completion', 'J10 object');
      assert(Array.isArray(body.choices), 'J10: choices should be array');
      assert(body.choices.length > 0, 'J10: choices not empty');
      assertEqual(body.choices[0].message.role, 'assistant', 'J10: role');
      assert(typeof body.choices[0].message.content === 'string', 'J10: content is string');
    });
  });
}

/** Helper to parse response body from a wrapped fetch response. */
async function parseBody(res) {
  try {
    return JSON.parse(res._rawBody);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('OpenAI Compatibility Tests');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Auth: ${API_KEY ? 'enabled' : 'disabled'}`);
  console.log('─'.repeat(50));

  // Check reachability
  const reachable = await checkServerReachable();
  if (!reachable) {
    console.log(`\n  ✗ Server not reachable at ${BASE_URL}`);
    console.log('  Ensure the extension is running and the server is started.\n');
    process.exit(1);
  }

  // Pre-flight auth check: warn early if server rejects auth
  if (API_KEY) {
    try {
      const preflight = await fetchWithTimeout(`${BASE_URL}/v1/models`, { method: 'GET' }, 5000);
      if (preflight.status === 401 || preflight.status === 403) {
        let reason = '';
        try {
          const body = JSON.parse(preflight._rawBody);
          if (body.error && body.error.message) {
            reason = ` — ${body.error.message}`;
          }
        } catch { /* ignore parse failure */ }
        console.log(`\n  ✗ Authentication failed (HTTP ${preflight.status})${reason}`);
        console.log('  Check that PROXY_API_KEY matches the server apiKey setting.\n');
        process.exit(1);
      }
    } catch {
      // Ignore — will be caught by individual test failures
    }
  }

  await testModelsEndpoint();
  await testChatCompletionsNonStreaming();
  await testChatCompletionsStreaming();
  await testInvalidRequests();
  await testCallHistoryCompatibility();
  await testMessageContentNormalization();
  await testAgentCompatibility();
  await testImageInputCompatibility();
  await testToolDiagnosticsAndValidation();
  await testToolChoicePolicy();

  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(f);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Monkey-patch fetch to capture raw response body text
// ---------------------------------------------------------------------------

const _origFetch = globalThis.fetch;
globalThis.fetch = async function patchedFetch(url, init) {
  const res = await _origFetch(url, init);
  // Clone and read body text into _rawBody for inspection
  const text = await res.text();
  // Build a plain wrapper — Object.create(res) fails with Node's private-field Response
  const status = res.status;
  const statusText = res.statusText;
  const ok = res.ok;
  const urlStr = res.url;
  const headers = res.headers;
  const wrapper = {
    status,
    statusText,
    ok,
    url: urlStr,
    headers,
    _rawBody: text,
    json: () => JSON.parse(text),
    text: () => Promise.resolve(text),
  };
  return wrapper;
};

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
