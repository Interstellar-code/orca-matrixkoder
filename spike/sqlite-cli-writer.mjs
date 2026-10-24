// Stand-in for `mk bug add` (node flavour): usage: node sqlite-cli-writer.mjs <db> <n> <startAt>
import { writeRows } from './writer-core.mjs';
const [db, n, startAt] = process.argv.slice(2);
console.log(JSON.stringify(writeRows({ db, n: +n, startAt: +startAt, tag: 'cli-node' })));
