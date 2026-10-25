/** Worker command `mk.state`: the same data as GET /api/state (C8). args: {screen?, repoId?, planId?, offset?, limit?}. */
import type { Service } from '../server/index.js';

export const commandId = 'mk.state';

export default function run(service: Service, args?: unknown): unknown {
  const a = (args ?? {}) as Record<string, unknown>;
  return service.state({
    screen: typeof a.screen === 'string' ? a.screen : undefined,
    repoId: typeof a.repoId === 'string' ? a.repoId : undefined,
    planId: typeof a.planId === 'number' ? a.planId : undefined,
    offset: typeof a.offset === 'number' ? a.offset : undefined,
    limit: typeof a.limit === 'number' ? a.limit : undefined,
  });
}
