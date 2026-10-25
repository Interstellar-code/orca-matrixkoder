export const commandId = 'mk.state';
export default function run(service, args) {
    const a = (args ?? {});
    return service.state({
        screen: typeof a.screen === 'string' ? a.screen : undefined,
        repoId: typeof a.repoId === 'string' ? a.repoId : undefined,
        planId: typeof a.planId === 'number' ? a.planId : undefined,
        offset: typeof a.offset === 'number' ? a.offset : undefined,
        limit: typeof a.limit === 'number' ? a.limit : undefined,
    });
}
