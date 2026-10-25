/** Worker command `mk.action`: the same as POST /api/action (C8). args: {name, args}. */
import type { Service } from '../server/index.js';

export const commandId = 'mk.action';

export default function run(service: Service, args?: unknown): Promise<unknown> {
  const a = (args ?? {}) as { name?: unknown; args?: unknown };
  return service.action(a.name, a.args);
}
