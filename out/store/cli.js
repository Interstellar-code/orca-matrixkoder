/**
 * The mk CLI (contract C4). bin/mk.mjs calls main(); tests call it with a stub Orca runner or run the real bin
 * with a stub `orca` on PATH.
 *
 * Output is JSON on stdout (the row that changed, or a list). Failure is exit 1 with one line on stderr.
 * Every Orca mutation passes --retry-request and starts its spec with an `mk-ref:` line, so a crash between the
 * Orca call and the row update leaves neither an orphan nor a duplicate: replaying the command returns the same
 * Orca receipt and the row update is redone.
 */
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { all, dataDir, nextBugId, now, one, openDb, tx } from './db.js';
class CliError extends Error {
    code;
    constructor(message, code = 1) {
        super(message);
        this.code = code;
    }
}
export const realOrca = (args) => {
    const r = spawnSync('orca', args, { encoding: 'utf8', timeout: 60_000 });
    if (r.error)
        throw new Error(`orca ${args.slice(0, 2).join(' ')} could not run: ${r.error.message}`);
    if (r.status !== 0) {
        const msg = (r.stderr || r.stdout || '').trim().split('\n')[0] || `exit ${r.status}`;
        throw new Error(`orca ${args.slice(0, 2).join(' ')} failed: ${msg}`);
    }
    return r.stdout;
};
function parseArgs(argv) {
    const pos = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') {
            pos.push(...argv.slice(i + 1));
            break;
        }
        if (!a.startsWith('--')) {
            pos.push(a);
            continue;
        }
        const eq = a.indexOf('=');
        if (eq > 0) {
            flags[a.slice(2, eq)] = a.slice(eq + 1);
            continue;
        }
        const name = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[name] = next;
            i++;
        }
        else {
            flags[name] = true;
        }
    }
    return { pos, flags };
}
const str = (p, name) => {
    const v = p.flags[name];
    if (v === undefined)
        return undefined;
    if (v === true)
        throw new CliError(`--${name} needs a value`, 2);
    return v;
};
const need = (p, name) => {
    const v = str(p, name);
    if (v === undefined || v === '')
        throw new CliError(`--${name} is required`, 2);
    return v;
};
function int(p, name, min, max) {
    const v = str(p, name);
    if (v === undefined)
        return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
        throw new CliError(`--${name} must be a whole number from ${min} to ${max}`, 2);
    return n;
}
// ---------------------------------------------------------------- helpers
const parseJson = (s, fallback) => {
    try {
        return JSON.parse(String(s));
    }
    catch {
        return fallback;
    }
};
function bugOut(r) {
    return { ...r, past_task_ids: parseJson(r.past_task_ids, []) };
}
function ensureRepo(db, id, path = '', name = '') {
    const t = now();
    db.prepare(`INSERT INTO repo(id, path, display_name, first_seen_at, last_seen_at) VALUES(?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`).run(id, path, name || (path ? basename(path) : id), t, t);
}
function git(cwd, args) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}
/** --repo / MK_REPO (id or path), else the repo the working directory belongs to (via mk-data.db, then `orca repo list`). */
function resolveRepo(db, p, ctx) {
    const given = str(p, 'repo') ?? ctx.env.MK_REPO;
    if (given) {
        const row = one(db, 'SELECT id FROM repo WHERE id = ? OR path = ?', given, given);
        return row ? String(row.id) : given;
    }
    const top = git(ctx.cwd, ['rev-parse', '--show-toplevel']);
    const common = git(ctx.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const candidates = [...new Set([common && common.replace(/\/\.git\/?$/, ''), top, ctx.cwd].filter((x) => !!x))];
    for (const c of candidates) {
        const row = one(db, 'SELECT id FROM repo WHERE path = ? AND gone_at IS NULL', c);
        if (row)
            return String(row.id);
    }
    try {
        const list = JSON.parse(ctx.orca(['repo', 'list', '--json']));
        const repos = list?.result?.repos ?? [];
        for (const c of candidates) {
            const hit = repos.find((r) => r.path === c);
            if (hit) {
                ensureRepo(db, hit.id, hit.path, hit.displayName);
                return hit.id;
            }
        }
    }
    catch {
        /* Orca not reachable: fall through to the explicit error */
    }
    throw new CliError('cannot tell which repo this is; run inside an Orca repo or pass --repo <id|path>', 2);
}
/** Pull an id out of an Orca receipt: {"ok":true,"result":{"task":{"id":..}}} or a flat {"result":{"id":..}}. */
function receiptId(stdout, kind, what) {
    let j;
    try {
        j = JSON.parse(stdout);
    }
    catch {
        throw new CliError(`${what} returned something that is not JSON: ${stdout.trim().slice(0, 120)}`);
    }
    const r = j?.result ?? j;
    const id = r?.[kind]?.id ?? r?.[`${kind}Id`] ?? r?.[`${kind}_id`] ?? r?.id;
    if (typeof id !== 'string' || id === '')
        throw new CliError(`${what} returned no ${kind} id: ${stdout.trim().slice(0, 160)}`);
    return id;
}
// ---------------------------------------------------------------- bug
function bugAdd(db, p, ctx) {
    const title = need(p, 'title');
    const details = str(p, 'details') ?? '';
    const file = str(p, 'file') ?? null;
    const line = int(p, 'line', 1, 10_000_000) ?? null;
    const risk = int(p, 'risk', 1, 5) ?? 3;
    const repo = resolveRepo(db, p, ctx);
    const by = str(p, 'reported-by') ?? ctx.env.MK_REPORTED_BY ?? 'agent';
    const t = now();
    return tx(db, () => {
        const id = nextBugId(db);
        db.prepare(`INSERT INTO bug(id, repo_id, title, details, file, line, risk, reported_by, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, repo, title, details, file, line, risk, by, t, t);
        return bugOut(one(db, 'SELECT * FROM bug WHERE id = ?', id));
    });
}
function getBug(db, id) {
    if (!id)
        throw new CliError('a bug id like B-1 is required', 2);
    const b = one(db, 'SELECT * FROM bug WHERE id = ?', id);
    if (!b)
        throw new CliError(`no bug ${id}`);
    return b;
}
function bugList(db, p, ctx) {
    const where = [];
    const args = [];
    if (str(p, 'repo') || ctx.env.MK_REPO) {
        where.push('repo_id = ?');
        args.push(resolveRepo(db, p, ctx));
    }
    const status = str(p, 'status');
    if (status) {
        where.push('status = ?');
        args.push(status);
    }
    const rows = all(db, `SELECT * FROM bug ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`, ...args);
    return rows.map(bugOut);
}
function fixSpec(b, repoPath, attempt) {
    const where = b.file ? `${b.file}${b.line ? `:${b.line}` : ''}` : '(no file given)';
    return [
        `mk-ref: bug:${b.id}#${attempt}`,
        '',
        `Fix bug ${b.id}: ${b.title}`,
        `Risk: ${b.risk}/5`,
        `Where: ${where}`,
        repoPath ? `Repo: ${repoPath}` : '',
        '',
        String(b.details || '(no details recorded)'),
    ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n');
}
function bugFix(db, p, ctx) {
    const b = getBug(db, p.pos[2]);
    if (b.status === 'fixed' || b.status === 'wontfix')
        throw new CliError(`${b.id} is ${b.status}; run "mk bug reopen ${b.id}" first`);
    ensureRepo(db, String(b.repo_id));
    const repo = one(db, 'SELECT * FROM repo WHERE id = ?', String(b.repo_id));
    // 1. The repo's bug run, created on first use. Same request id on replay returns the same run.
    let runId = repo.bug_run_id ? String(repo.bug_run_id) : '';
    if (!runId) {
        const name = String(repo.display_name || repo.id);
        runId = receiptId(ctx.orca(['orchestration', 'run-create', '--objective', `MK bug fixes: ${name}`, '--retry-request', `mk-run-bug-${repo.id}`, '--json']), 'run', 'orca run-create');
        tx(db, () => db.prepare('UPDATE repo SET bug_run_id = ? WHERE id = ? AND bug_run_id IS NULL').run(runId, repo.id));
        runId = String(one(db, 'SELECT bug_run_id FROM repo WHERE id = ?', String(repo.id)).bug_run_id);
    }
    // 2. The Orca task, then the row. The attempt number is in both the request id and the mk-ref line.
    const attempt = Number(b.attempts) + 1;
    const title = `${b.id} ${b.title}`.slice(0, 120);
    const taskId = receiptId(ctx.orca([
        'orchestration', 'task-create',
        '--spec', fixSpec(b, String(repo.path || ''), attempt),
        '--task-title', title,
        '--run', runId,
        '--retry-request', `mk-bug-${b.id}-${attempt}`,
        '--json',
    ]), 'task', 'orca task-create');
    const t = now();
    return tx(db, () => {
        const cur = one(db, 'SELECT * FROM bug WHERE id = ?', String(b.id));
        // A replay of the same attempt (crash after the Orca call) must not push the new id into the past list.
        const past = parseJson(cur.past_task_ids, []);
        if (cur.orca_task_id && cur.orca_task_id !== taskId)
            past.push(String(cur.orca_task_id));
        const attempts = Number(cur.attempts) >= attempt ? Number(cur.attempts) : attempt;
        // last_state is the sync loop's column; it is reset here because it described the previous task.
        db.prepare(`UPDATE bug SET orca_run_id=?, orca_task_id=?, attempts=?, past_task_ids=?, status='fixing',
              last_state=NULL, last_state_at=NULL, fixed_at=NULL, updated_at=? WHERE id=?`).run(runId, taskId, attempts, JSON.stringify(past), t, String(b.id));
        return bugOut(one(db, 'SELECT * FROM bug WHERE id = ?', String(b.id)));
    });
}
function bugSetStatus(db, id, to) {
    const b = getBug(db, id);
    if (to === 'wontfix' && (b.status === 'wontfix' || b.status === 'fixed'))
        throw new CliError(`${b.id} is already ${b.status}`);
    if (to === 'open' && (b.status === 'open' || b.status === 'fixing' || b.status === 'waiting'))
        throw new CliError(`${b.id} is already ${b.status}`);
    const t = now();
    tx(db, () => db.prepare('UPDATE bug SET status=?, fixed_at=NULL, updated_at=? WHERE id=?').run(to, t, String(b.id)));
    return bugOut(one(db, 'SELECT * FROM bug WHERE id = ?', String(b.id)));
}
// ---------------------------------------------------------------- todo
function todoAdd(db, p, ctx) {
    const text = (str(p, 'text') ?? p.pos.slice(2).join(' ')).trim();
    if (!text)
        throw new CliError('todo text is required: mk todo add "<text>"', 2);
    const grp = str(p, 'group') ?? 'today';
    if (!['today', 'soon', 'later'].includes(grp))
        throw new CliError('--group must be today, soon or later', 2);
    const repo = resolveRepo(db, p, ctx);
    const t = now();
    return tx(db, () => {
        const sort = Number(one(db, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM todo WHERE repo_id = ? AND grp = ?', repo, grp).n);
        const id = db.prepare('INSERT INTO todo(repo_id, text, grp, sort, created_at) VALUES(?,?,?,?,?) RETURNING id').get(repo, text, grp, sort, t).id;
        return one(db, 'SELECT * FROM todo WHERE id = ?', id);
    });
}
function todoDone(db, p) {
    const id = Number(p.pos[2]);
    if (!Number.isInteger(id))
        throw new CliError('a numeric todo id is required: mk todo done <id>', 2);
    if (!one(db, 'SELECT id FROM todo WHERE id = ?', id))
        throw new CliError(`no todo ${id}`);
    tx(db, () => db.prepare('UPDATE todo SET done = 1, done_at = COALESCE(done_at, ?) WHERE id = ?').run(now(), id));
    return one(db, 'SELECT * FROM todo WHERE id = ?', id);
}
function todoList(db, p, ctx) {
    const where = [];
    const args = [];
    if (str(p, 'repo') || ctx.env.MK_REPO) {
        where.push('repo_id = ?');
        args.push(resolveRepo(db, p, ctx));
    }
    if (!p.flags.all)
        where.push('done = 0');
    return all(db, `SELECT * FROM todo ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY grp, sort, id`, ...args);
}
// ---------------------------------------------------------------- subtask, ask
const SUBTASK_STATUS = ['pending', 'working', 'waiting', 'blocked', 'done'];
function subtaskSet(db, p) {
    const code = p.pos[2];
    const status = p.pos[3];
    if (!code || !status)
        throw new CliError('usage: mk subtask set <code> <status> [--note <text>] [--plan <slug>]', 2);
    if (!SUBTASK_STATUS.includes(status))
        throw new CliError(`status must be one of ${SUBTASK_STATUS.join(', ')}`, 2);
    const slug = str(p, 'plan');
    const rows = all(db, `SELECT s.id, p.slug FROM plan_subtask s JOIN plan p ON p.id = s.plan_id
      WHERE s.code = ? AND s.dropped_at IS NULL ${slug ? 'AND p.slug = ?' : ''}`, ...(slug ? [code, slug] : [code]));
    if (rows.length === 0)
        throw new CliError(`no subtask ${code}${slug ? ` in plan ${slug}` : ''}`);
    if (rows.length > 1)
        throw new CliError(`subtask ${code} is in several plans (${rows.map((r) => r.slug).join(', ')}); pass --plan <slug>`, 2);
    const note = str(p, 'note');
    tx(db, () => db
        .prepare(`UPDATE plan_subtask SET status = ?, ${note !== undefined ? 'note = ?,' : ''} updated_at = ? WHERE id = ?`)
        .run(...(note !== undefined ? [status, note, now(), rows[0].id] : [status, now(), rows[0].id])));
    return one(db, 'SELECT * FROM plan_subtask WHERE id = ?', rows[0].id);
}
function askNote(db, p, ctx) {
    const id = p.pos[2];
    if (!id)
        throw new CliError('usage: mk ask note <ask-id> --text <text>', 2);
    const text = need(p, 'text').slice(0, 300);
    if (!one(db, 'SELECT id FROM ask WHERE id = ?', id))
        throw new CliError(`no ask ${id}`);
    tx(db, () => db.prepare('UPDATE ask SET recommendation = ?, rec_source = ? WHERE id = ?').run(text, ctx.env.MK_REPORTED_BY ?? 'cli', id));
    return one(db, 'SELECT id, kind, title, recommendation, rec_source FROM ask WHERE id = ?', id);
}
// ---------------------------------------------------------------- dispatch
const USAGE = `usage: mk <command>
  mk bug add --title <t> --details <d> [--file <f> --line <n> --risk 1-5] [--repo <id|path>]
  mk bug list [--status <s>] [--repo <id|path>]
  mk bug fix B-n | mk bug close B-n | mk bug reopen B-n
  mk todo add "<text>" [--group today|soon|later] | mk todo done <id> | mk todo list [--all]
  mk subtask set <code> <status> [--note <text>] [--plan <slug>]
  mk ask note <ask-id> --text <text>`;
function run(db, p, ctx) {
    const [group, sub] = p.pos;
    switch (`${group} ${sub}`) {
        case 'bug add': return bugAdd(db, p, ctx);
        case 'bug list': return bugList(db, p, ctx);
        case 'bug fix': return bugFix(db, p, ctx);
        case 'bug close': return bugSetStatus(db, p.pos[2], 'wontfix');
        case 'bug reopen': return bugSetStatus(db, p.pos[2], 'open');
        case 'todo add': return todoAdd(db, p, ctx);
        case 'todo done': return todoDone(db, p);
        case 'todo list': return todoList(db, p, ctx);
        case 'subtask set': return subtaskSet(db, p);
        case 'ask note': return askNote(db, p, ctx);
        default: throw new CliError(USAGE, 2);
    }
}
/** Returns the process exit code. */
export function main(argv, ctx) {
    const p = parseArgs(argv);
    if (p.pos.length === 0 || p.flags.help) {
        (p.pos.length === 0 && !p.flags.help ? ctx.err : ctx.out)(USAGE);
        return p.pos.length === 0 && !p.flags.help ? 2 : 0;
    }
    let db;
    try {
        db = openDb(ctx.dir ?? dataDir(ctx.env));
        ctx.out(JSON.stringify(run(db, p, ctx)));
        return 0;
    }
    catch (e) {
        const msg = e.message.split('\n')[0];
        ctx.err(`mk: ${msg}`);
        return e instanceof CliError ? e.code : 1;
    }
    finally {
        db?.close();
    }
}
