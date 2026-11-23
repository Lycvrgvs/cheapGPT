// Every guard of cheapgpt.mjs, seen passing and refusing, on throwaway repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cheapgpt.mjs');
const PLAN = (extra = '') => `# plan\n## Goals\n- G1 | "a counter that adds" | C1, C2, C3${extra ? ', C4' : ''}\n## Acceptance
- C1 | CORE | add(2,3) prints 5 | run: node app.js 2 3 | boundary: add(0,0) prints 0
- C2 | CORE | add rejects non-numbers | run: node app.js a 1 | boundary: "1e3" is a number
- C3 | NON-CORE | --help prints usage | run: node app.js --help | boundary: -h too${extra}\n## Backlog\n## Drop\n## Mechanism\nplain node\n## Handoffs\n`;

function repo({ existing = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const g = (...x) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { cwd: d, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(d, '.cheapgpt')); fs.copyFileSync(TOOL, path.join(d, '.cheapgpt', 'cheapgpt.mjs'));
  fs.writeFileSync(path.join(d, 'AGENTS.md'), 'method\n');
  if (existing) { fs.writeFileSync(path.join(d, 'app.js'), 'console.log(1)\n'); g('add', 'app.js'); g('commit', '-q', '-m', 'existing'); }
  const cg = (...x) => { const r = spawnSync('node', ['.cheapgpt/cheapgpt.mjs', ...x], { cwd: d, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  const ok = (...x) => { const r = cg(...x); assert.equal(r.code, 0, `${x.join(' ')}\n${r.out}`); return r.out; };
  const no = (re, ...x) => { const r = cg(...x); assert.notEqual(r.code, 0, `expected a refusal: ${x.join(' ')}\n${r.out}`); assert.match(r.out, re); return r.out; };
  const state = () => JSON.parse(fs.readFileSync(path.join(d, 'cheapgpt', 'state.json'), 'utf8'));
  const callId = (out) => out.match(/^call (\w+)/m)[1];
  const wtOf = (out) => path.join(d, out.match(/^worktree: (\S+)/m)[1]);
  const child = (out, files) => { const wt = wtOf(out); for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(wt, f), c); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: wt }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'build'], { cwd: wt }); return callId(out); };
  const reply = (id, body) => fs.writeFileSync(path.join(d, 'cheapgpt', 'runs', id, 'out.md'), body);
  const met = (ids) => ids.map((i) => `${i} | MET | evidence: run output | counterfeit: hardcoded 5 | boundary: 0+0 printed 0`).join('\n');
  const notMet = (i) => `${i} | NOT_MET | case: node app.js 0 0; printed nothing`;
  const commit = (f, c) => { fs.writeFileSync(path.join(d, f), c); ok('git', 'add', f); ok('git', 'commit', '-q', '-m', 'seam'); };
  const writePlan = (t) => fs.writeFileSync(path.join(d, 'cheapgpt', 'plan.md'), t);
  return { d, cg, ok, no, state, callId, child, reply, met, notMet, commit, writePlan };
}
function toLoop(r) { // a new project, preflighted and planned
  r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  r.ok('preflight', 'P1', 'ok', 'spawn_agent args show models'); r.ok('preflight', 'P2', 'ok', 'session log shows gpt models');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, 'READY'); r.ok('isolation');
  r.ok('advance', 'PLAN'); r.writePlan(PLAN()); r.ok('freeze'); r.ok('advance', 'LOOP');
}
let n = 0;
function loop(r, targets, verdicts, { reproduce = 'yes', before = false } = {}) { // one tiny loop with given reviewer lines
  n++;
  r.ok('stepback', 'tiny', '--targets', targets.join(','), 'evidence: nothing yet; cause: unbuilt; smallest move: build it; allocation dynamic');
  if (before) r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  const id = r.child(r.ok('call', 'dynamic'), { [`f${n}.js`]: `// ${n}\n` });
  r.ok('merge', id); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, verdicts); r.ok('review', rv);
  for (const [i, x] of Object.entries(r.state().entry.judged.alleged)) if (x.status === undefined) r.ok('reproduce', i, reproduce, 'node app.js 0 0 → (nothing)');
  return r.state();
}

test('M: preflight needs P1, P2 and a reviewer that leaves the repository unchanged', () => {
  const r = repo(); r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  r.no(/P1 ok[\s\S]*P2 ok or requested[\s\S]*P3/, 'advance', 'PLAN');
  r.no(/P1 ok\|fail/, 'preflight', 'P1', 'requested', 'only requested settings');
  r.ok('preflight', 'P1', 'ok', 'spawn_agent args'); assert.match(r.ok('preflight', 'P2', 'requested', 'record shows request only'), /as requested, not confirmed/);
  const rv = r.callId(r.ok('call', 'reviewer')); fs.writeFileSync(path.join(r.d, 'leak.txt'), 'x');
  r.no(/CHANGED/, 'isolation'); r.no(/P3/, 'advance', 'PLAN');
  fs.rmSync(path.join(r.d, 'leak.txt')); r.ok('isolation'); r.ok('advance', 'PLAN');
  assert.equal(r.state().state, 'PLAN'); void rv;
});

test('M: the plan traces goals to criteria with a deciding run and a boundary', () => {
  const r = repo(); toLoop(r);
  const r2 = repo(); r2.ok('init', 'FOCUSED', 'x', 'y'); r2.ok('preflight', 'P1', 'ok', 'spawn_agent args'); r2.ok('preflight', 'P2', 'ok', 'session log');
  const rv = r2.callId(r2.ok('call', 'reviewer')); r2.reply(rv, 'READY'); r2.ok('isolation'); r2.ok('advance', 'PLAN');
  r2.writePlan(PLAN().replace(' | boundary: -h too', '').replace('C1, C2, C3', 'C1, C2'));
  const out = r2.no(/C3: missing boundary[\s\S]*C3: no goal traces/, 'freeze');
  r2.no(/plan: /, 'advance', 'LOOP'); r2.writePlan(PLAN()); r2.ok('freeze'); r2.ok('advance', 'LOOP'); void out;
});

test('M: a tiny loop needs PREVENT, disjoint committed builders, a merge, a run on HEAD, then a review', () => {
  const r = repo(); toLoop(r);
  r.no(/PREVENT first/, 'call', 'dynamic');
  r.no(/loop-breaker builds alone|dynamic and mechanical/, 'call', 'breaker');
  r.ok('stepback', 'tiny', '--targets', 'C1,C2', 'evidence: none; cause: unbuilt; move: build add; allocation dyn+mech');
  const dOut = r.ok('call', 'dynamic'), mOut = r.ok('call', 'mechanical'); r.no(/one dynamic per loop/, 'call', 'dynamic');
  const idle = r.callId(dOut); r.no(/committed nothing/, 'merge', idle);
  const a = r.child(dOut, { 'app.js': 'a\n' }), b = r.child(mOut, { 'app.js': 'b\n', 'lib.js': 'l\n' });
  r.no(/both builders changed app.js/, 'merge', `${a},${b}`);
  r.no(/not a builder/, 'merge', 'deadbeef');
  const r3 = repo(); toLoop(r3); r3.ok('stepback', 'tiny', '--targets', 'C1,C2', 'evidence: none; cause: unbuilt; move: build add; allocation dyn+mech');
  const x = r3.child(r3.ok('call', 'dynamic'), { 'app.js': 'a\n' }), y = r3.child(r3.ok('call', 'mechanical'), { 'lib.js': 'l\n' });
  r3.no(/merge the builders/, 'call', 'reviewer');
  r3.ok('merge', `${x},${y}`); r3.no(/run the affected path on this commit/, 'call', 'reviewer');
  r3.ok('run', '--', 'node -e 1'); r3.commit('seam.js', 's'); r3.no(/run the affected path on this commit/, 'call', 'reviewer');
  r3.ok('run', '--', 'node -e 1'); fs.writeFileSync(path.join(r3.d, 'wip.js'), 'w'); r3.no(/commit the candidate first/, 'call', 'reviewer'); fs.rmSync(path.join(r3.d, 'wip.js'));
  const rv = r3.callId(r3.ok('call', 'reviewer'));
  r3.reply(rv, 'C1 | MET | evidence: printed 5 | counterfeit: none\nC2 | MET | evidence: e | counterfeit: c | boundary: b');
  r3.no(/C1: MET needs evidence, counterfeit and boundary[\s\S]*redispatch/, 'review', rv);
  r3.ok('redispatch', rv); r3.reply(rv, r3.met(['C1', 'C2'])); r3.ok('review', rv);
  const s = r3.state(); assert.equal(s.entry.judged.outcome, 'PASS'); assert.equal(s.base, s.entry.judged.sha); assert.deepEqual(s.est.sort(), ['C1', 'C2']);
});

test('M: a review is void when the repository changes during it; a second incomplete reply blocks', () => {
  const r = repo(); toLoop(r);
  r.ok('stepback', 'tiny', '--targets', 'C1', 'evidence: none; cause: unbuilt; move: build add; allocation dyn');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'app.js': 'a\n' })); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1']));
  fs.writeFileSync(path.join(r.d, 'app.js'), 'changed by reviewer\n'); r.no(/changed during the review: void/, 'review', rv);
  r.ok('git', 'checkout', '-q', '--', 'app.js'); r.ok('redispatch', rv); r.reply(rv, 'nothing');
  r.no(/blocked → re-plan/, 'review', rv); assert.equal(r.state().level, 'replan');
});

test('M: the acceptance list is provisional until the core gate, then frozen hard', () => {
  const r = repo(); toLoop(r);
  r.writePlan(PLAN().replace('C1, C2, C3', 'C1, C3').replace(/- C2 .*\n/, '')); r.no(/needs the user \(removed: C2; the goals changed\)/, 'freeze');
  r.no(/plan changed since the freeze/, 'stepback', 'tiny', '--targets', 'C1', 'x'.repeat(50));
  r.ok('freeze', '--user', 'drop C2, not needed'); assert.deepEqual(r.state().frozenSet.ids, ['C1', 'C3']);
  loop(r, ['C1'], r.met(['C1'])); r.ok('advance', 'GATE');
  r.no(/run the product end to end on this commit first/, 'call', 'reviewer');
  r.ok('run', '--e2e', '--', 'node -e 1'); const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1'])); r.ok('review', rv);
  const s = r.state(); assert.equal(s.stage, 'NON-CORE'); assert.equal(s.hard, true);
  r.no(/release gate|NON-CORE stage comes first|NON-CORE criteria open/, 'advance', 'ACCEPT');
  r.ok('advance', 'LOOP'); r.writePlan(PLAN().replace('C1, C2, C3', 'C1, C3').replace(/- C2 .*\n/, '').replace('-h too', '-h and --usage')); r.no(/frozen hard: only a re-plan/, 'freeze');
});

test('M: gates run end to end on the reviewed commit; the release gate prunes first; ACCEPT delivers the gated commit', () => {
  const r = repo(); toLoop(r);
  r.writePlan(PLAN('\n- C4 | NON-CORE | it is pleasant to use | run: try it | boundary: first use | judge: user — add two numbers and say if the output is clear')); r.ok('freeze', '--user', 'add a criterion I judge myself');
  loop(r, ['C1', 'C2'], r.met(['C1', 'C2'])); r.ok('advance', 'GATE');
  r.ok('run', '--e2e', '--', 'node -e 1'); r.commit('docs.md', 'late doc'); r.no(/end to end on this commit/, 'call', 'reviewer');
  r.ok('run', '--e2e', '--', 'node -e 1'); let rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1', 'C2'])); r.ok('review', rv);
  r.ok('advance', 'LOOP'); r.no(/not in this stage's scope: C4|unknown/, 'stepback', 'tiny', '--targets', 'C9', 'x'.repeat(50));
  loop(r, ['C3'], r.met(['C3'])); r.ok('advance', 'GATE');
  r.ok('run', '--e2e', '--', 'node -e 1'); r.no(/records the prune first/, 'call', 'reviewer');
  r.ok('prune', 'none'); r.no(/end to end on this commit first/, 'call', 'reviewer'); // the e2e run predates the prune
  r.ok('run', '--e2e', '--', 'node -e 1'); rv = r.callId(r.ok('call', 'reviewer'));
  r.reply(rv, r.met(['C1', 'C2'])); r.no(/C3: no verdict line/, 'review', rv); r.ok('redispatch', rv);
  r.reply(rv, r.met(['C1', 'C2', 'C3'])); r.ok('review', rv); r.ok('advance', 'ACCEPT');
  r.no(/user's reply[\s\S]*final report/, 'advance', 'DONE');
  const fin = r.ok('report', '--final'); assert.match(fin, /Yours to judge:\n- C4 it is pleasant to use — add two numbers/);
  r.ok('answer', 'accepted'); r.commit('extra.md', 'after the gate'); r.no(/is not the gated/, 'advance', 'DONE');
  r.ok('git', 'reset', '-q', '--hard', 'HEAD~1'); r.ok('advance', 'DONE'); r.ok('clean');
  assert.ok(!fs.existsSync(path.join(r.d, 'cheapgpt', 'state.json')) && !fs.existsSync(path.join(r.d, 'temporary')));
});

test('M: an existing project is adopted from a baseline run and its plan is reviewed once', () => {
  const r = repo({ existing: true }); r.ok('init', 'FOCUSED', 'demo', 'extend the counter');
  assert.equal(r.state().state, 'ADOPT');
  r.no(/baseline real run[\s\S]*adoption record/, 'advance', 'PREFLIGHT');
  r.ok('run', '--', 'node app.js'); r.ok('adopt', 'app.js prints 1 on the baseline run; no existing tests to protect');
  r.ok('advance', 'PREFLIGHT'); r.ok('preflight', 'P1', 'ok', 'spawn_agent args'); r.ok('preflight', 'P2', 'ok', 'session log');
  let rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, 'READY'); r.ok('isolation'); r.ok('advance', 'PLAN');
  r.writePlan(PLAN()); r.ok('freeze'); r.no(/the plan review/, 'advance', 'LOOP');
  rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, 'FIX: C2 boundary misses empty input'); r.ok('planreview', rv);
  r.no(/FIX applied once, then freeze/, 'advance', 'LOOP'); r.no(/reviewed once/, 'planreview', rv);
  r.writePlan(PLAN().replace('"1e3" is a number', 'empty input is rejected')); r.ok('freeze'); r.ok('advance', 'LOOP');
});

test('M: the flow validator accepts the shipped flow', () => {
  const r = repo(); assert.match(r.cg('check').out, /FLOW OK: 8 states/);
});

// ── the ladder, per level, and the step back at each size ────────────────────────────────
const MORE = (ids) => ids.map((i) => `\n- ${i} | CORE | verb ${i} prints its result | run: node app.js ${i} | boundary: zero operands`).join('');
function planned(r, extra = []) { // a new project planned with C1, C2 (CORE), C3 (NON-CORE) and extra CORE criteria
  r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  r.ok('preflight', 'P1', 'ok', 'spawn_agent args show models'); r.ok('preflight', 'P2', 'ok', 'session log shows gpt models');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, 'READY'); r.ok('isolation'); r.ok('advance', 'PLAN');
  r.writePlan(PLAN().replace('C1, C2, C3', ['C1', 'C2', 'C3', ...extra].join(', ')).replace('-h too', '-h too' + MORE(extra)));
  r.ok('freeze'); r.ok('advance', 'LOOP');
}
const verdicts = (r, met, failed) => [r.met(met), ...failed.map((i) => r.notMet(i))].filter(Boolean).join('\n');
function breaker(r, targets, met, failed, { replan = null } = {}) { // one loop-breaker loop (level full, or re-plan with the user's words)
  n++;
  if (replan) r.ok('replan', replan);
  const out = r.ok('call', 'breaker');
  r.ok('stepback', replan ? 'replan' : 'full', '--targets', targets.join(','), 'the whole: every run and finding; class: argv parsing; root cause: one parser for all verbs; remove the per-verb patches; correction: one parser rule');
  if (replan) r.ok('approve', 'go ahead');
  if (targets.some((t) => r.state().failed.includes(t))) r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(out, { [`b${n}.js`]: `// ${n}\n` })); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, verdicts(r, met, failed)); r.ok('review', rv);
  for (const i of failed) r.ok('reproduce', i, 'yes', 'node app.js 0 0 → (nothing)');
  return r.state();
}
const tiny = (r, targets, met, failed) => loop(r, targets, verdicts(r, met, failed), { before: targets.some((t) => r.state().failed.includes(t)) });

test('M: tiny STALLED stays once, the 2nd → full; a dropped candidate is saved and the product reset to BASE; full PASS → tiny', () => {
  const r = repo(); planned(r);
  let s = tiny(r, ['C1', 'C2'], ['C2'], ['C1']); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.equal(s.level, 'tiny');
  r.ok('advance', 'LOOP'); r.ok('stepback', 'tiny', '--targets', 'C1', 'the whole: 0+0 prints nothing; class: falsy zero; remove the guard; one rule');
  r.no(/C1 failed before: reproduce on BASE/, 'merge', 'x'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'g.js': 'g\n' })); r.ok('run', '--', 'node -e 1');
  let rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.notMet('C1')); r.ok('review', rv); r.ok('reproduce', 'C1', 'yes', 'node app.js 0 0 → nothing');
  s = r.state(); assert.equal(s.history[1].outcome, 'STALLED'); assert.equal(s.level, 'tiny'); assert.equal(s.count.STALLED, 1);
  assert.ok(s.history[1].saved && fs.existsSync(path.join(r.d, s.history[1].saved)), 'the dropped candidate is saved'); assert.match(r.ok('git', 'rev-parse', 'HEAD'), new RegExp(s.base));
  r.ok('advance', 'LOOP'); s = tiny(r, ['C1'], [], ['C1']); assert.equal(s.history[2].outcome, 'STALLED'); assert.equal(s.level, 'full'); assert.equal(s.count.STALLED, 0);
  r.ok('advance', 'LOOP'); r.no(/loop-breaker builds alone/, 'call', 'dynamic');
  const br = r.ok('call', 'breaker'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"'); const bid = r.child(br, { 'h.js': 'h\n' });
  r.no(/its step back first|diagnosis first/, 'merge', bid);
  r.no(/answers its questions/, 'stepback', 'full', '--targets', 'C1', 'too short for a full one');
  r.ok('stepback', 'full', '--targets', 'C1', 'the whole: zero treated as missing in parse and in sum; class: truthiness; root cause: the brief; one rule: compare to undefined');
  r.ok('merge', bid); r.ok('run', '--', 'node -e 1'); rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1'])); r.ok('review', rv);
  s = r.state(); assert.equal(s.history[3].outcome, 'PASS'); assert.equal(s.level, 'tiny'); assert.deepEqual(s.count, { ADVANCED: 0, STALLED: 0, REGRESSION: 0 });
  r.ok('advance', 'GATE');
});

test('M: tiny ADVANCED stays twice, the 3rd → full; full ADVANCED → tiny', () => {
  const r = repo(); planned(r, ['C5', 'C6', 'C7']);
  let s = tiny(r, ['C1', 'C2', 'C5', 'C6', 'C7'], ['C1'], ['C2', 'C5', 'C6', 'C7']); assert.equal(s.level, 'tiny'); assert.equal(s.count.ADVANCED, 1);
  r.ok('advance', 'LOOP'); s = tiny(r, ['C2', 'C5', 'C6', 'C7'], ['C2'], ['C5', 'C6', 'C7']); assert.equal(s.level, 'tiny'); assert.equal(s.count.ADVANCED, 2);
  r.ok('advance', 'LOOP'); s = tiny(r, ['C5', 'C6', 'C7'], ['C5'], ['C6', 'C7']); assert.equal(s.history[2].outcome, 'ADVANCED'); assert.equal(s.level, 'full');
  r.ok('advance', 'LOOP'); s = breaker(r, ['C6', 'C7'], ['C6'], ['C7']); assert.equal(s.history[3].outcome, 'ADVANCED'); assert.equal(s.level, 'tiny');
});

test('M: full STALLED stays once, the 2nd → re-plan; tiny REGRESSION stays once, the 2nd → full', () => {
  const r = repo(); planned(r);
  tiny(r, ['C1', 'C2'], ['C1'], ['C2']); r.ok('advance', 'LOOP'); tiny(r, ['C2'], [], ['C2']); r.ok('advance', 'LOOP');
  let s = tiny(r, ['C2'], [], ['C2']); assert.equal(s.level, 'full');
  r.ok('advance', 'LOOP'); s = breaker(r, ['C2'], [], ['C2']); assert.equal(s.history[3].outcome, 'STALLED'); assert.equal(s.level, 'full'); assert.equal(s.count.STALLED, 1);
  r.ok('advance', 'LOOP'); s = breaker(r, ['C2'], [], ['C2']); assert.equal(s.level, 'replan');
  const g = repo(); planned(g);
  tiny(g, ['C1', 'C2'], ['C1'], ['C2']); g.ok('advance', 'LOOP');
  s = tiny(g, ['C1', 'C2'], [], ['C1', 'C2']); assert.equal(s.history[1].outcome, 'REGRESSION'); assert.equal(s.level, 'tiny'); assert.equal(s.count.REGRESSION, 1); assert.ok(s.est.includes('C1'), 'BASE keeps what it established');
  g.ok('advance', 'LOOP'); s = tiny(g, ['C1', 'C2'], [], ['C1', 'C2']); assert.equal(s.history[2].outcome, 'REGRESSION'); assert.equal(s.level, 'full');
});

test('M: the first core loop STALLED goes straight to re-plan; a re-plan needs the user\'s words, the loop-breaker\'s step back, a frozen plan and approval before the build', () => {
  const r = repo(); planned(r);
  let s = tiny(r, ['C1'], [], ['C1']); assert.equal(s.history[0].outcome, 'STALLED'); assert.equal(s.level, 'replan');
  r.ok('advance', 'LOOP');
  r.no(/re-plan starts with the user's words/, 'call', 'breaker');
  r.no(/level replan: stepback replan/, 'stepback', 'tiny', '--targets', 'C1', 'x'.repeat(50));
  r.no(/re-plan starts with the user's words/, 'stepback', 'replan', '--targets', 'C1', 'x'.repeat(90));
  r.ok('replan', 'keep zero valid; try integer parsing');
  const br = r.ok('call', 'breaker'); const early = r.child(br, { 'early.js': 'e\n' });
  r.no(/loop-breaker's step back first/, 'approve', 'go ahead');
  r.ok('stepback', 'replan', '--targets', 'C1', 'the whole: every attempt parsed floats; class: numeric parsing; root cause: the plan picked floats; new plan: integers only');
  r.writePlan(PLAN().replace('add(0,0) prints 0', 'add(0,0) prints 0 and add(-1,1) prints 0')); r.no(/freeze the new plan first/, 'approve', 'go ahead');
  r.ok('freeze'); r.no(/user reviews the new plan/, 'merge', early);
  r.ok('approve', 'go ahead'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.no(/commits from before the user approved/, 'merge', early);
  const g = repo(); planned(g); tiny(g, ['C1'], [], ['C1']); g.ok('advance', 'LOOP');
  s = breaker(g, ['C1'], ['C1'], [], { replan: 'try integer parsing' });
  assert.equal(s.history[1].outcome, 'PASS'); assert.equal(s.level, 'tiny'); assert.deepEqual(s.count, { ADVANCED: 0, STALLED: 0, REGRESSION: 0 });
});

test('M: a gate REGRESSION un-establishes the criterion and stays tiny once; NOT_MET dismissed establishes; missing evidence stays open without being a defect', () => {
  const r = repo(); planned(r);
  tiny(r, ['C1', 'C2'], ['C1', 'C2'], []); r.ok('advance', 'GATE'); r.ok('run', '--e2e', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, verdicts(r, ['C2'], ['C1'])); r.ok('review', rv); r.ok('reproduce', 'C1', 'yes', 'node app.js 0 0 → nothing');
  let s = r.state(); assert.equal(s.history[1].outcome, 'REGRESSION'); assert.equal(s.level, 'tiny'); assert.ok(!s.est.includes('C1'));
  const d = repo(); planned(d); s = loop(d, ['C1'], d.notMet('C1'), { reproduce: 'no' });
  assert.equal(s.history[0].outcome, 'PASS'); assert.ok(s.est.includes('C1'));
  const x = repo(); planned(x);
  x.ok('stepback', 'tiny', '--targets', 'C1,C2', 'the whole: nothing built; build add and validation; allocation dynamic');
  x.ok('merge', x.child(x.ok('call', 'dynamic'), { 'a.js': 'a\n' })); x.ok('run', '--', 'node -e 1');
  const rx = x.callId(x.ok('call', 'reviewer')); x.reply(rx, verdicts(x, ['C1'], ['C2'])); x.ok('review', rx);
  x.no(/yes\|missing\|no/, 'reproduce', 'C2', 'maybe', 'x'.repeat(20));
  x.ok('reproduce', 'C2', 'missing', 'the 8-minute deciding run could not be made in the review');
  s = x.state(); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.ok(!s.est.includes('C2')); assert.ok(!s.failed.includes('C2'), 'missing is not a defect');
  assert.match(x.ok('report'), /C2 \| CORE \| open \(evidence missing\)/);
  x.ok('advance', 'LOOP'); x.ok('stepback', 'tiny', '--targets', 'C2', 'the whole: the deciding run needs 8 minutes; make it runnable; allocation mechanical');
  x.ok('merge', x.child(x.ok('call', 'mechanical'), { 'clock.js': 'c\n' })); // no run --before owed: nothing was reproduced
});

const asNobody = process.getuid && process.getuid() === 0 && spawnSync('runuser', ['--help']).status === 0;
test('M: init probes the writes it makes, and moves the repository to cheapgpt/git when .git refuses them', { skip: !asNobody && 'needs root and runuser to drop privileges' }, () => {
  const r = repo({ existing: true });
  spawnSync('chown', ['-R', 'nobody', r.d]);
  // the observed sandbox: refs/heads and worktrees writable, so a branch ref and a detached worktree pass; .git itself, info/ and config refuse writes
  fs.mkdirSync(path.join(r.d, '.git', 'worktrees'), { recursive: true }); spawnSync('chown', ['-R', 'nobody', path.join(r.d, '.git', 'worktrees')]);
  for (const p of ['.git', '.git/info', '.git/config']) fs.chmodSync(path.join(r.d, p), fs.statSync(path.join(r.d, p)).isDirectory() ? 0o555 : 0o444);
  const run = (...x) => spawnSync('runuser', ['-u', 'nobody', '--', 'node', '.cheapgpt/cheapgpt.mjs', ...x], { cwd: r.d, encoding: 'utf8', env: { ...process.env, HOME: r.d } });
  const old = spawnSync('runuser', ['-u', 'nobody', '--', 'sh', '-c', 'git -c safe.directory=* update-ref refs/heads/cg-probe HEAD && echo REF-OK'], { cwd: r.d, encoding: 'utf8' });
  assert.match(old.stdout, /REF-OK/, 'the old probe would have passed here');
  const out = run('init', 'FOCUSED', 'demo', 'extend the counter');
  assert.equal(out.status, 0, out.stdout + out.stderr); assert.match(out.stdout, /repository lives in cheapgpt\/git/);
  assert.ok(fs.existsSync(path.join(r.d, 'cheapgpt', 'git', 'HEAD')));
  const wt = run('git', 'worktree', 'add', '-q', '-b', 'cg/check', 'cheapgpt/wt/check', 'HEAD'); assert.equal(wt.status, 0, wt.stdout + wt.stderr);
  const w = repo(); w.ok('init', 'FOCUSED', 'demo', 'writable'); assert.ok(!fs.existsSync(path.join(w.d, 'cheapgpt', 'git')), 'a writable .git stays in use');
  assert.doesNotMatch(w.ok('git', 'branch', '--list', 'cg/probe-*'), /probe/, 'the probe leaves nothing behind');
});
