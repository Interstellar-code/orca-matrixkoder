/**
 * T11 (USE.5): task spec templates (C10). Unit cases for the loader and renderer; the task.start / bug.fix wiring
 * is in actions.test.mjs, the migration in db.test.mjs, the import copy in import.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_BUILTIN } from '../../out/store/spec-builtin.js';
import { SPEC_SCENARIOS, defaultSettings, mergeSettings } from '../../out/store/settings.js';
import { listValue, loadTemplate, pickScenario, renderSpec, rulesLines, templateStatuses } from '../../out/store/spec-templates.js';
import { tempDir } from '../tmp.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (p) => tempDir(`mk-tpl-${p}-`);
const withTpl = (patch) => mergeSettings(defaultSettings(), { work: { specTemplates: patch } });

function world() {
  const dir = tmp('data');
  const repoPath = tmp('repo');
  const put = (root, rel, text) => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
    return full;
  };
  return { dir, repoPath, env: { dir, repoPath }, put };
}

const TASK = {
  code: 'X.1', title: 'do the thing', phase: 'Phase X', risk: '3', size: 'standard', attempt: '1', description: 'the description',
  acceptance: listValue(['a1', 'a2']), owned: listValue(['src/a.ts']), deps: listValue(['X.0']), gate: 'npm test', manual: 'look at it', repo: '/r',
};
const BUG = { code: 'bug B-1', bugId: 'B-1', title: 'it crashes', risk: '5', attempt: '1', file: 'src/a.ts:9', line: '9', details: 'stack trace', repo: '/r' };
const render = (scenario, vals, w, settings = defaultSettings(), rules = []) =>
  renderSpec({ ref: 'mk-ref: test#1', scenario, vals, rules, settings, env: w.env });

test('T11: each spec-builtin.ts constant equals its templates/spec/<scenario>.md', () => {
  assert.deepEqual(Object.keys(SPEC_BUILTIN), [...SPEC_SCENARIOS]);
  for (const s of SPEC_SCENARIOS) assert.equal(SPEC_BUILTIN[s], readFileSync(join(ROOT, 'templates', 'spec', `${s}.md`), 'utf8'), s);
});

test('T11: a built-in renders with no templates folder, every scenario, no placeholder left, mk-ref first', () => {
  const w = world(); // an empty data dir and repo: nothing on disk
  for (const s of SPEC_SCENARIOS) {
    const r = render(s, TASK, w);
    assert.deepEqual(r.warnings, [], s);
    assert.equal(r.text.split('\n')[0], 'mk-ref: test#1', s);
    assert.ok(!r.text.includes('{{'), `${s} left a placeholder`);
    const facts = ['Phase: Phase X', 'Risk: 3/5', 'the description', '- a1', '- a2', 'Gate: npm test', 'Manual check: look at it'];
    facts.push(s === 'fix' ? 'Fix X.1: do the thing' : 'X.1 do the thing');
    if (s !== 'fix') facts.push('Depends on:\n- X.0');
    for (const f of facts) assert.ok(r.text.includes(f), `${s} lacks ${f}`);
  }
  const t = (s) => render(s, TASK, world()).text;
  assert.match(t('investigate'), /Do not edit, create or delete any file/);
  assert.match(t('review'), /Do not edit any file/);
  assert.match(t('implement'), /Edit only the files and components you own/);
  assert.match(t('implement'), /Files you own:\n- src\/a\.ts/);
  assert.match(t('subdispatch'), /one writer per file/i);
  assert.match(t('fix'), /test that fails before the fix and passes after/);
});

test('T11: empty known placeholders render empty and their lines are dropped', () => {
  const w = world();
  const t = render('implement', { code: 'X.2', title: 'bare', phase: 'P', risk: '1' }, w).text;
  for (const gone of ['Gate:', 'Manual check:', 'Acceptance:', 'Depends on:', 'Files you own:', 'Repo:']) assert.ok(!t.includes(gone), gone);
  assert.ok(!/\n\n\n/.test(t), 'no run of blank lines');
  assert.ok(!t.endsWith('\n'));
});

test('T11: the shared fix template renders both a task retry and a bug', () => {
  const w = world();
  const bug = render('fix', BUG, w).text;
  assert.equal(bug.split('\n')[0], 'mk-ref: test#1');
  assert.match(bug, /Fix bug B-1: it crashes/);
  assert.match(bug, /Risk: 5\/5/);
  assert.match(bug, /Where: src\/a\.ts:9/);
  assert.match(bug, /stack trace/);
  assert.ok(!bug.includes('Phase:') && !bug.includes('Gate:') && !bug.includes('Acceptance:'), 'task-only lines dropped for a bug');
  const retry = render('fix', { ...TASK, attempt: '2' }, w).text;
  assert.match(retry, /Fix X\.1: do the thing/);
  assert.match(retry, /Attempt: 2/);
  assert.match(retry, /Acceptance:\n- a1/);
  assert.ok(!retry.includes('Where:'), 'bug-only line dropped for a task');
});

test('T11: scenario choice: explicit task, retry, bug, else implement; a phase with subagents and no scenario is implement', () => {
  assert.equal(pickScenario({ explicit: 'review', attempt: 3, bug: true }), 'review');
  assert.equal(pickScenario({ explicit: null, attempt: 2 }), 'fix');
  assert.equal(pickScenario({ bug: true }), 'fix');
  assert.equal(pickScenario({ attempt: 1 }), 'implement');
  assert.equal(pickScenario({}), 'implement');
  assert.equal(pickScenario({ explicit: 'nonsense' }), 'implement');
  assert.equal(pickScenario({ explicit: 'subdispatch' }), 'subdispatch');
});

test('T11: a user file is used when set and its edit is picked up (mtime); status reports the file', () => {
  const w = world();
  const file = w.put(w.repoPath, 'docs/review.md', '{{code}} CUSTOM v1\n{{rules}}\n');
  const s = withTpl({ review: 'docs/review.md' });
  const a = render('review', TASK, w, s, ['R']);
  assert.equal(a.text, 'mk-ref: test#1\n\nX.1 CUSTOM v1\nR');
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(loadTemplate(s, 'review', w.env).status, { path: 'docs/review.md', source: 'file', ok: true, issue: null });
  writeFileSync(file, '{{code}} CUSTOM v2 {{title}}\n{{rules}}\n');
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(render('review', TASK, w, s, ['R']).text, 'mk-ref: test#1\n\nX.1 CUSTOM v2 do the thing\nR');
  // other scenarios stay built-in
  assert.equal(loadTemplate(s, 'fix', w.env).status.source, 'builtin');
});

test('T11: ~/.matrixkoder/templates/ resolves under the data dir (MK_DATA_DIR)', () => {
  const w = world();
  w.put(w.dir, 'templates/inv.md', '{{title}} from home\n{{rules}}\n');
  const s = withTpl({ investigate: '~/.matrixkoder/templates/inv.md' });
  assert.equal(render('investigate', TASK, w, s, ['R']).text, 'mk-ref: test#1\n\ndo the thing from home\nR');
  assert.equal(loadTemplate(s, 'investigate', { dir: w.dir, repoPath: '' }).status.source, 'file', 'no repo needed for a home template');
});

test('T11: a missing file, a ".." path, a 40 KB file and an unknown placeholder each fall back with a warning', () => {
  const w = world();
  w.put(w.repoPath, 'big.md', `{{title}}\n${'x'.repeat(40 * 1024)}`);
  w.put(w.repoPath, 'unk.md', '{{title}} {{nope}}\n');
  w.put(w.repoPath, 'ok.md', '{{title}}\n');
  const cases = [
    ['gone.md', /does not exist/],
    ['../escape.md', /"\.\."/],
    ['docs/../ok.md', /"\.\."/],
    ['/etc/passwd', /relative/],
    ['~/other/x.md', /relative|exist/],
    ['big.md', /4\d KB; the limit is 32 KB/],
    ['unk.md', /unknown placeholder \{\{nope\}\}/],
  ];
  for (const [path, why] of cases) {
    const s = withTpl({ implement: path });
    const r = render('implement', TASK, w, s);
    assert.equal(r.warnings.length, 1, path);
    assert.match(r.warnings[0], why, path);
    assert.match(r.warnings[0], /using the built-in template/, path);
    assert.equal(r.text, render('implement', TASK, w).text, `${path} renders the built-in`);
    const st = loadTemplate(s, 'implement', w.env).status;
    assert.equal(st.ok, false, path);
    assert.equal(st.source, 'builtin', path);
    assert.equal(st.path, path);
    assert.match(st.issue, why, path);
  }
  // no repo path known: a repo-relative file cannot be found
  const s = withTpl({ implement: 'ok.md' });
  assert.match(loadTemplate(s, 'implement', { dir: w.dir, repoPath: '' }).status.issue, /repo path is unknown/);
});

test('T11: a symlink inside the repo that leads outside it is refused', () => {
  const w = world();
  const outside = tmp('out');
  writeFileSync(join(outside, 'secret.md'), '{{title}}');
  mkdirSync(join(w.repoPath, 'docs'), { recursive: true });
  symlinkSync(join(outside, 'secret.md'), join(w.repoPath, 'docs', 'link.md'));
  const st = loadTemplate(withTpl({ implement: 'docs/link.md' }), 'implement', w.env).status;
  assert.equal(st.ok, false);
  assert.match(st.issue, /leaves its root folder/);
});

test('T11: a user template without {{rules}} still gets the rules appended, plus a warning', () => {
  const w = world();
  w.put(w.repoPath, 't.md', '{{title}}\n');
  const s = withTpl({ implement: 't.md' });
  const rules = rulesLines(mergeSettings(defaultSettings(), { safety: { askBeforePush: true } }));
  assert.ok(rules.length > 0);
  const r = render('implement', TASK, w, s, rules);
  assert.equal(r.text, `mk-ref: test#1\n\ndo the thing\n\n${rules.join('\n')}`);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /no \{\{rules\}\}; the rules section was appended/);
  assert.match(loadTemplate(s, 'implement', w.env).status.issue, /no \{\{rules\}\}/);
  // with no rules there is nothing to append and no warning
  assert.deepEqual(render('implement', TASK, w, s, []).warnings, []);
});

test('T11: the built-ins carry the C7/C8 rules, including the solo line', () => {
  const w = world();
  const solo = mergeSettings(defaultSettings(), { general: { mode: 'solo' } });
  const r = render('implement', TASK, w, solo, rulesLines(solo));
  assert.match(r.text, /Rules from MatrixKoder settings:/);
  assert.match(r.text, /Solo mode: work in this checkout/);
  assert.deepEqual(r.warnings, []);
});

test('T11: templateStatuses covers all five scenarios', () => {
  const w = world();
  w.put(w.repoPath, 'r.md', '{{title}} {{rules}}');
  const st = templateStatuses(withTpl({ review: 'r.md', fix: 'gone.md' }), w.env);
  assert.deepEqual(Object.keys(st), [...SPEC_SCENARIOS]);
  assert.deepEqual(st.implement, { path: '', source: 'builtin', ok: true, issue: null });
  assert.deepEqual(st.review, { path: 'r.md', source: 'file', ok: true, issue: null });
  assert.equal(st.fix.ok, false);
});
