// Child process for the two-writer test: opens the same database and files N bugs, one transaction each.
import { openDb, tx, nextBugId } from '../../out/store/db.js';

const [dir, tag, n] = process.argv.slice(2);
const db = openDb(dir);
for (let i = 0; i < Number(n); i++) {
  tx(db, () => {
    const id = nextBugId(db);
    const t = Date.now();
    db.prepare("INSERT INTO bug(id, repo_id, title, created_at, updated_at) VALUES(?,?,?,?,?)").run(id, 'repo-x', `${tag}-${i}`, t, t);
  });
}
db.close();
