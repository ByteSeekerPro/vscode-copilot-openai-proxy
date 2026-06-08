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
//
// Exit code 0 = all tests passed, 1 = at least one failure.

const BASE_PORT = process.env.PROXY_PORT || 9090;
const BASE_URL = `http://127.0.0.1:${BASE_PORT}`;
const TIMEOUT_MS = 15_000;

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

/** Fetch with timeout. */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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

    // F5: Unsupported image_url content returns 400, not 500
    it('F5: image_url content returns 400', async () => {
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
      assertEqual(res.status, 400, 'F5 status');
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

    // G6: unsupported image_url returns 400 with OpenAI error shape
    it('G6: image_url returns 400 with OpenAI error shape', async () => {
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
// Main runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('OpenAI Compatibility Tests');
  console.log(`Server: ${BASE_URL}`);
  console.log('─'.repeat(50));

  // Check reachability
  const reachable = await checkServerReachable();
  if (!reachable) {
    console.log(`\n  ✗ Server not reachable at ${BASE_URL}`);
    console.log('  Ensure the extension is running and the server is started.\n');
    process.exit(1);
  }

  await testModelsEndpoint();
  await testChatCompletionsNonStreaming();
  await testChatCompletionsStreaming();
  await testInvalidRequests();
  await testCallHistoryCompatibility();
  await testMessageContentNormalization();
  await testAgentCompatibility();

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
