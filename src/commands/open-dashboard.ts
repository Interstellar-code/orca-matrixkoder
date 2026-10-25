/**
 * Worker command `open-dashboard` ("MatrixKoder: Open Dashboard", Mod+Alt+D): opens the live dashboard in an Orca
 * browser tab at http://127.0.0.1:<port>/?t=<token>. The worker starts the service first if it is not up (src/worker.ts),
 * so this module always gets a running one. If a tab already shows this service's dashboard, it is brought to the
 * front instead of opening a second one. Both Orca calls go through the allowlist (`tab create`, `tab switch`);
 * the tab list is a typed read.
 */
import { execOrca, runAction, tabList } from '../orca/index.js';
import type { Runner } from '../orca/index.js';
import type { Service } from '../server/index.js';

export const commandId = 'open-dashboard';

export interface OpenDashboardResult {
  ok: boolean;
  /** 'created': a new tab; 'focused': an open dashboard tab was brought to the front. */
  tab?: 'created' | 'focused';
  port?: number;
  error?: string;
}

/** Opens (or focuses) the dashboard tab for a running service. Never throws and never returns the token. */
export async function openDashboard(service: Pick<Service, 'url' | 'port'>, runner: Runner = execOrca): Promise<OpenDashboardResult> {
  const origin = `http://127.0.0.1:${service.port}/`;

  // Reuse: a tab whose address is this service's page. A tab from an earlier start has another port, so it never matches
  // (unless a restart happens to get the same port: that tab holds the old token and needs a reload).
  const tabs = await tabList(runner);
  const existing = tabs.ok ? tabs.value.tabs.find((t) => t.url === origin) : undefined;
  if (existing) {
    const switched = await runAction('tab switch', { page: existing.browserPageId, focus: true }, runner);
    if (switched.ok) return { ok: true, tab: 'focused', port: service.port };
    // fall through: a tab that cannot be focused (closed since the list) gets replaced by a new one
  }

  const created = await runAction('tab create', { url: service.url }, runner);
  // Orca's message may echo the URL; the token must not reach the command result or Orca's error display
  const reason = created.ok ? '' : created.error.message.replace(/([?&]t=)[^\s&#"']+/g, '$1[token]');
  if (!created.ok) return { ok: false, port: service.port, error: `Orca could not open the dashboard tab: ${reason}` };
  return { ok: true, tab: 'created', port: service.port };
}

/** A failure throws, so Orca shows the command as failed with the reason. */
export default async function run(service: Service): Promise<OpenDashboardResult> {
  const r = await openDashboard(service);
  if (!r.ok) throw new Error(r.error);
  return r;
}
