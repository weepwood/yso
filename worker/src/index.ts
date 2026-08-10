interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
  WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET') return new Response('yso webhook gateway: ok');
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? request.headers.get('x-yso-webhook-secret');
    if (!env.WEBHOOK_SECRET || token !== env.WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });

    let payload: unknown;
    try { payload = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

    const hint = extractHint(payload);
    const dispatchBody = JSON.stringify({
      event_type: 'yuque_webhook',
      client_payload: {
        received_at: new Date().toISOString(),
        doc_id: hint.docId,
        action: hint.action,
      },
    });

    const response = await dispatchWithRetry(env, dispatchBody);
    if (!response.ok) return new Response(`GitHub dispatch failed: ${response.status}`, { status: 502 });
    return new Response('OK', { status: 200 });
  },
};

function extractHint(payload: unknown): { docId?: number; action?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data as Record<string, unknown> : {};
  const rawId = data.id ?? data.doc_id ?? root.doc_id;
  const docId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : undefined;
  const actionValue = root.action ?? root.type ?? root.event;
  const action = typeof actionValue === 'string' ? actionValue : undefined;
  return { docId, action };
}

async function dispatchWithRetry(env: Env, body: string): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'yso-webhook-worker',
        'Content-Type': 'application/json',
      },
      body,
    });
    last = response;
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) return response;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  return last ?? new Response('Dispatch failed before request', { status: 502 });
}
