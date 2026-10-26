/**
 * MK route agent ids against Orca's two id spaces (contract C5, C9): the `quota` table's provider key and the
 * `--agent` id `worker-start` takes. One table, read by task.start (routes.ts) and the snapshot.
 */
/** The `quota.provider` key of an agent; null = Orca reports no quota for it. */
const PROVIDER = {
    claude: 'claude', codex: 'codex', agy: 'antigravity', opencode: 'opencodeGo', gemini: 'gemini', omp: null,
};
/** The `--agent` id Orca expects; an agent not listed here is passed as written. */
const ORCA_AGENT = { agy: 'antigravity' };
/** The quota provider of a route agent, or null (omp, an agent MK does not know). */
export const providerOf = (agent) => (Object.hasOwn(PROVIDER, agent) ? PROVIDER[agent] : null);
/** The id for Orca's `--agent` flag. */
export const orcaAgentId = (agent) => (Object.hasOwn(ORCA_AGENT, agent) ? ORCA_AGENT[agent] : agent);
