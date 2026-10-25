export const commandId = 'mk.action';
export default function run(service, args) {
    const a = (args ?? {});
    return service.action(a.name, a.args);
}
