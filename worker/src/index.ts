interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
  WEBHOOK_SECRET: string;
}

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const API_VERSION = '2026-03-10';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    if (request.method === 'GET') {
      return textResponse('yso webhook gateway: ok', 200, requestId);
    }
    if (request.method !== 'POST') {
      return textResponse('Method Not Allowed', 405, requestId);
    }

    if (!isTargetConfigured(env)) {
      console.error(JSON.stringify({ event: 'configuration_error', request_id: requestId }));
      return textResponse('Worker target repository is not configured', 500, requestId);
    }

    const url = new URL(request.url);
    const token = request.headers.get('x-yso-webhook-secret') ?? url.searchParams.get('token');
    if (!env.WEBHOOK_SECRET || !safeEqual(token, env.WEBHOOK_SECRET)) {
      console.warn(JSON.stringify({ event: 'authentication_failed', request_id: requestId }));
      return textResponse('Unauthorized', 401, requestId);
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
      console.warn(JSON.stringify({ event: 'payload_too_large', request_id: requestId, declared_bytes: declaredLength }));
      return textResponse('Payload Too Large', 413, requestId);
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return textResponse('Invalid request body', 400, requestId);
    }

    const bodyBytes = new TextEncoder().encode(rawBody).byteLength;
    if (bodyBytes > MAX_WEBHOOK_BODY_BYTES) {
      console.warn(JSON.stringify({ event: 'payload_too_large', request_id: requestId, actual_bytes: bodyBytes }));
      return textResponse('Payload Too Large', 413, requestId);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return textResponse('Invalid JSON', 400, requestId);
    }

    const hint = extractHint(payload);
    console.log(JSON.stringify({
      event: 'webhook_received',
      request_id: requestId,
      target: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      doc_id: hint.docId,
      action: hint.action,
      bytes: bodyBytes,
    }));

    const dispatchBody = JSON.stringify({
      event_type: 'yuque_webhook',
      client_payload: {
        received_at: new Date().toISOString(),
        request_id: requestId,
        doc_id: hint.docId,
        action: hint.action,
      },
    });

    const { response, attempts } = await dispatchWithRetry(env, dispatchBody, requestId);
    if (!response.ok) {
      console.error(JSON.stringify({
        event: 'github_dispatch_failed',
        request_id: requestId,
        status: response.status,
        attempts,
      }));
      return textResponse(`GitHub dispatch failed: ${response.status}`, 502, requestId);
    }

    console.log(JSON.stringify({
      event: 'github_dispatch_succeeded',
      request_id: requestId,
      status: response.status,
      attempts,
    }));
    return textResponse('OK', 200, requestId);
  },
};

function isTargetConfigured(env: Env): boolean {
  return Boolean(
    env.GITHUB_OWNER &&
    env.GITHUB_REPO &&
    env.GITHUB_OWNER !== 'CHANGE_ME' &&
    env.GITHUB_REPO !== 'CHANGE_ME'
  );
}

function safeEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function textResponse(body: string, status: number, requestId: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-YSO-Request-Id': requestId,
    },
  });
}

function extractHint(payload: unknown): { docId?: number; action?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {};
  const rawId = data.id ?? data.doc_id ?? root.doc_id;
  const docId = typeof rawId === 'number'
    ? rawId
    : typeof rawId === 'string' && /^\d+$/.test(rawId)
      ? Number(rawId)
      : undefined;
  const actionValue = root.action ?? root.type ?? root.event;
  const action = typeof actionValue === 'string' ? actionValue : undefined;
  return { docId, action };
}

async function dispatchWithRetry(
  env: Env,
  body: string,
  requestId: string,
): Promise<{ response: Response; attempts: number }> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'yso-webhook-worker',
        'Content-Type': 'application/json',
      },
      body,
    });
    last = response;
    const attempts = attempt + 1;
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      return { response, attempts };
    }

    console.warn(JSON.stringify({
      event: 'github_dispatch_retry',
      request_id: requestId,
      status: response.status,
      attempt: attempts,
    }));
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }

  return {
    response: last ?? new Response('Dispatch failed before request', { status: 502 }),
    attempts: 3,
  };
}
