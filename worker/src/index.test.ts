import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function env(overrides = {}) {
  return {
    GITHUB_OWNER: 'weepwood',
    GITHUB_REPO: 'yqo',
    GITHUB_TOKEN: 'github-test-token',
    WEBHOOK_SECRET: 'webhook-test-secret',
    ...overrides,
  };
}

test('GET health check does not require configuration', async () => {
  const response = await worker.fetch(new Request('https://worker.example/'), env());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'yso webhook gateway: ok');
});

test('rejects unsupported HTTP methods', async () => {
  const response = await worker.fetch(new Request('https://worker.example/', { method: 'PUT' }), env());
  assert.equal(response.status, 405);
});

test('rejects an unconfigured GitHub target', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/?token=webhook-test-secret', { method: 'POST', body: '{}' }),
    env({ GITHUB_REPO: 'CHANGE_ME' }),
  );
  assert.equal(response.status, 500);
  assert.match(await response.text(), /not configured/);
});

test('rejects invalid webhook secret', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: { 'x-yso-webhook-secret': 'wrong' },
      body: '{}',
    }),
    env(),
  );
  assert.equal(response.status, 401);
});

test('rejects invalid JSON', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/?token=webhook-test-secret', { method: 'POST', body: '{' }),
    env(),
  );
  assert.equal(response.status, 400);
});

test('dispatches Worker-compatible yuque_webhook payload to GitHub', async () => {
  let capturedUrl = '';
  let capturedInit;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 204 });
  };

  const response = await worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: { 'x-yso-webhook-secret': 'webhook-test-secret' },
      body: JSON.stringify({ action: 'doc.updated', data: { id: '280859522' } }),
    }),
    env(),
  );

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, 'https://api.github.com/repos/weepwood/yqo/dispatches');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers.Authorization, 'Bearer github-test-token');
  assert.equal(capturedInit.headers['X-GitHub-Api-Version'], '2026-03-10');
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.event_type, 'yuque_webhook');
  assert.equal(body.client_payload.doc_id, 280859522);
  assert.equal(body.client_payload.action, 'doc.updated');
  assert.match(body.client_payload.received_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('accepts secret in query string for Yuque webhook configuration', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  const response = await worker.fetch(
    new Request('https://worker.example/?token=webhook-test-secret', {
      method: 'POST',
      body: JSON.stringify({ event: 'publish', doc_id: 42 }),
    }),
    env(),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('retries GitHub 429 and 5xx responses, then succeeds', async () => {
  const statuses = [429, 503, 204];
  let calls = 0;
  globalThis.fetch = async () => {
    const status = statuses[calls++] ?? 204;
    return new Response(null, { status });
  };
  const response = await worker.fetch(
    new Request('https://worker.example/?token=webhook-test-secret', { method: 'POST', body: '{}' }),
    env(),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test('does not retry non-429 GitHub 4xx responses', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 403 });
  };
  const response = await worker.fetch(
    new Request('https://worker.example/?token=webhook-test-secret', { method: 'POST', body: '{}' }),
    env(),
  );
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});
