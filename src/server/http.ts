/**
 * The HTTP face of the worker: 127.0.0.1 only, a fresh random token per start, and a Host check on every request.
 *
 *   GET  /api/state?screen=&repo=&plan=&offset=&limit=   the C6 snapshot
 *   GET  /api/events?before=&limit=                        a page of events, newest first
 *   GET  /api/event/<id>                                   one event with its payload
 *   POST /api/action  {name, args}                         a button
 *   GET  /api/ping                                         liveness
 *   GET  /, /<file>                                        the dashboard page from the plugin's web/ folder
 *
 * Every request needs Host `127.0.0.1:<port>` and the token, else 403. API calls take the token only in the
 * `x-mk-token` header (a custom header cannot be sent cross-site without a CORS preflight, which is never granted).
 * The page and its files also accept `?t=<token>` or the cookie set by the first page load, because a browser tab
 * cannot add a header to a navigation.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ActionError } from './common.js';

export const TOKEN_HEADER = 'x-mk-token';
const MAX_BODY = 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

export const STATUS_OF: Record<ActionError['kind'], number> = {
  unknown_action: 400, bad_args: 400, not_found: 404, conflict: 409, orca_failed: 502, store_failed: 500, unauthorized: 403, too_large: 413,
};

/** What the server needs from the service behind it. */
export interface Backend {
  state(q: { screen?: string; repoId?: string; planId?: number; offset?: number; limit?: number }): unknown;
  events(q: { before?: number; limit?: number }): unknown;
  event(id: number): unknown | null;
  action(name: unknown, args: unknown): Promise<{ ok: boolean; error?: ActionError; [k: string]: unknown }>;
}

export interface DashboardServer {
  readonly token: string;
  readonly port: number;
  /** `http://127.0.0.1:<port>/?t=<token>`: what to open in an Orca browser tab. */
  readonly url: string;
  close(): Promise<void>;
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
const sameToken = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...extra,
  });
  res.end(body);
}
const json = (res: ServerResponse, status: number, v: unknown): void => send(res, status, JSON.stringify(v), 'application/json; charset=utf-8');

function readBody(req: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
  return new Promise((resolveBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolveBody({ ok: false });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolveBody({ ok: false }));
  });
}

const intParam = (v: string | null): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export function startHttp(backend: Backend, opts: { webDir: string; log: (m: string) => void; port?: number; token?: string }): Promise<DashboardServer> {
  const token = opts.token ?? randomBytes(24).toString('hex');
  const webRoot = resolve(opts.webDir);
  let port = 0;

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      opts.log(`[http] ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: { kind: 'store_failed', message: 'the server hit an unexpected error' } });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { ok: false, error: { kind: 'unauthorized', message: 'forbidden' } });
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const isApi = url.pathname.startsWith('/api/');
    const header = req.headers[TOKEN_HEADER];
    const given = typeof header === 'string' ? header : '';
    const cookie = /(?:^|;\s*)mk_token=([0-9a-f]+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? '';
    const query = url.searchParams.get('t') ?? '';
    const ok = given !== '' && sameToken(given, token);
    const okPage = ok || (!isApi && ((query !== '' && sameToken(query, token)) || (cookie !== '' && sameToken(cookie, token))));
    if (!okPage) return json(res, 403, { ok: false, error: { kind: 'unauthorized', message: 'forbidden' } });

    if (req.method === 'POST') {
      if (url.pathname !== '/api/action') return json(res, 404, { ok: false, error: { kind: 'not_found', message: 'not found' } });
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return json(res, 415, { ok: false, error: { kind: 'bad_args', message: 'send application/json' } });
      const body = await readBody(req);
      if (!body.ok) return json(res, 413, { ok: false, error: { kind: 'too_large', message: 'request body too large' } });
      let parsed: { name?: unknown; args?: unknown };
      try {
        parsed = JSON.parse(body.text) as { name?: unknown; args?: unknown };
      } catch {
        return json(res, 400, { ok: false, error: { kind: 'bad_args', message: 'the body is not JSON' } });
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return json(res, 400, { ok: false, error: { kind: 'bad_args', message: 'the body must be {name, args}' } });
      const out = await backend.action(parsed.name, parsed.args);
      return json(res, out.ok ? 200 : STATUS_OF[out.error?.kind ?? 'store_failed'], out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: { kind: 'bad_args', message: 'method not allowed' } });

    if (isApi) {
      const p = url.searchParams;
      if (url.pathname === '/api/ping') return json(res, 200, { ok: true, pid: process.pid, upSec: Math.round(process.uptime()) });
      if (url.pathname === '/api/state') {
        return json(res, 200, backend.state({
          screen: p.get('screen') ?? undefined, repoId: p.get('repo') ?? undefined, planId: intParam(p.get('plan')), offset: intParam(p.get('offset')), limit: intParam(p.get('limit')),
        }));
      }
      if (url.pathname === '/api/events') return json(res, 200, backend.events({ before: intParam(p.get('before')), limit: intParam(p.get('limit')) }));
      const m = /^\/api\/event\/(\d+)$/.exec(url.pathname);
      if (m) {
        const e = backend.event(Number(m[1]));
        return e ? json(res, 200, e) : json(res, 404, { ok: false, error: { kind: 'not_found', message: `no event ${m[1]}` } });
      }
      return json(res, 404, { ok: false, error: { kind: 'not_found', message: 'not found' } });
    }
    return serveFile(url.pathname, res, query !== '' && sameToken(query, token));
  }

  function serveFile(pathname: string, res: ServerResponse, setCookie: boolean): void {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return json(res, 400, { ok: false, error: { kind: 'bad_args', message: 'bad path' } });
    }
    if (rel.includes('\0')) return json(res, 400, { ok: false, error: { kind: 'bad_args', message: 'bad path' } });
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = resolve(join(webRoot, normalize(rel)));
    if (full !== webRoot && !full.startsWith(webRoot + sep)) return json(res, 403, { ok: false, error: { kind: 'unauthorized', message: 'forbidden' } });
    if (!existsSync(full) || !statSync(full).isFile()) return json(res, 404, { ok: false, error: { kind: 'not_found', message: 'not found' } });
    const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
    const extra: Record<string, string> = setCookie ? { 'set-cookie': `mk_token=${token}; Path=/; HttpOnly; SameSite=Strict` } : {};
    if (type.startsWith('text/html')) {
      // hand the page its token without a round trip: <meta name="mk-token">
      let html = readFileSync(full, 'utf8');
      const meta = `<meta name="mk-token" content="${token}">`;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}${meta}`) : meta + html;
      return send(res, 200, html, type, extra);
    }
    send(res, 200, readFileSync(full), type, extra);
  }

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolveStart({
        token,
        port,
        url: `http://127.0.0.1:${port}/?t=${token}`,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}
