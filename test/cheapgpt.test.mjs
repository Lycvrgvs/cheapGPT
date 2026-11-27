// Every guard of cheapgpt.mjs, seen refusing once at the transition it gates and then passing, on throwaway repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), TOOL = path.join(SRC, 'cheapgpt.mjs');
const CMDRE = /node \.cheapgpt\/cheapgpt\.mjs [a-z]+/;
const PLAN = (extra = '') => `# plan\n## Goals\n- G1 | "a counter that adds" | C1, C2, C3${extra ? ', C4' : ''}\n## Acceptance
- C1 | CORE | add(2,3) prints 5 | run: node app.js 2 3 | boundary: add(0,0) prints 0
- C2 | CORE | add rejects non-numbers | run: node app.js a 1 | boundary: "1e3" is a number
- C3 | NON-CORE | --help prints usage | run: node app.js --help | boundary: -h too${extra}\n## Backlog\n## Drop\n## Mechanism\nplain node\n## Handoffs\n`;
const USER_C4 = '\n- C4 | NON-CORE | it is pleasant to use | run: try it | boundary: first use | judge: user — add two numbers and say if the output is clear';
const asserted = {}; // guard[:branch] → how many times its refusal was asserted (the audit test reads it)

function repo({ existing = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const g = (...x) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { cwd: d, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(d, '.cheapgpt')); fs.copyFileSync(TOOL, path.join(d, '.cheapgpt', 'cheapgpt.mjs'));
  fs.copyFileSync(path.join(SRC, 'flow.json'), path.join(d, '.cheapgpt', 'flow.json')); fs.cpSync(path.join(SRC, 'cards'), path.join(d, '.cheapgpt', 'cards'), { recursive: true });
  fs.writeFileSync(path.join(d, 'AGENTS.md'), 'method\n');
  if (existing) { fs.writeFileSync(path.join(d, 'app.js'), 'console.log(1)\n'); g('add', 'app.js'); g('commit', '-q', '-m', 'existing'); }
  const cg = (...x) => { const r = spawnSync('node', ['.cheapgpt/cheapgpt.mjs', ...x], { cwd: d, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  const ok = (...x) => { const r = cg(...x); assert.equal(r.code, 0, `${x.join(' ')}\n${r.out}`); return r.out; };
  const no = (re, ...x) => { // a command's refusal; a transition's refusal goes through refuse()
    assert.notEqual(x[0], 'advance', 'assert a transition with refuse(<guard>, ...)');
    const r = cg(...x); assert.notEqual(r.code, 0, `expected a refusal: ${x.join(' ')}\n${r.out}`); assert.match(r.out, re); return r.out;
  };
  const refuse = (tags, re, to) => { // a guard's refusal at the transition it gates, asserted once in the whole suite; it names the command that satisfies it
    const r = cg('advance', to); assert.notEqual(r.code, 0, `expected ${tags} to refuse advance ${to}\n${r.out}`); assert.match(r.out, re); assert.match(r.out, CMDRE, 'the refusal names the command that satisfies it');
    for (const t of [tags].flat()) asserted[t] = (asserted[t] || 0) + 1;
    return r.out;
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(d, 'cheapgpt', 'state.json'), 'utf8'));
  const callId = (out) => out.match(/^call (\w+)/m)[1];
  const wtOf = (out) => path.join(d, out.match(/^worktree: (\S+)/m)[1]);
  const child = (out, files) => { const wt = wtOf(out); for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(wt, f), c); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: wt }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'build'], { cwd: wt }); return callId(out); };
  const reply = (id, body) => fs.writeFileSync(path.join(d, 'cheapgpt', 'runs', id, 'out.md'), body);
  const met = (ids) => ids.map((i) => `${i} | MET | evidence: run output | counterfeit: hardcoded 5 | boundary: 0+0 printed 0`).join('\n');
  const notMet = (i) => `${i} | NOT_MET | case: node app.js 0 0; printed nothing`;
  const commit = (f, c) => { fs.writeFileSync(path.join(d, f), c); ok('git', 'add', f); ok('git', 'commit', '-q', '-m', 'seam'); };
  const writePlan = (t) => fs.writeFileSync(path.join(d, 'cheapgpt', 'plan.md'), t);
  const prevent = (...sb) => { ok('stepback', ...sb, 'the whole: goals, all evidence, the one risk'); ok('block', 'the next action, whole: add.js parses argv and prints the sum'); };
  return { d, g, cg, ok, no, refuse, state, callId, child, reply, met, notMet, commit, writePlan, prevent };
}
const MORE = (ids) => ids.map((i) => `\n- ${i} | CORE | verb ${i} prints its result | run: node app.js ${i} | boundary: zero operands`).join('');
function planned(r, { extra = [], route = 'FULL', plan = null } = {}) { // a new project, planned and frozen: C1, C2 (CORE), C3 (NON-CORE), extra CORE criteria
  r.ok('init', route, 'demo', 'a small counter'); r.prevent();
  r.writePlan(plan || PLAN().replace('C1, C2, C3', ['C1', 'C2', 'C3', ...extra].join(', ')).replace('-h too', '-h too' + MORE(extra)));
  r.ok('freeze'); r.ok('advance', 'LOOP');
}
const verdicts = (r, met, failed) => [r.met(met), ...failed.map((i) => r.notMet(i))].filter(Boolean).join('\n');
let n = 0;
function loop(r, targets, lines, { reproduce = 'yes', before = false } = {}) { // one tiny loop of a FULL task, with the given reviewer lines
  n++;
  r.prevent('tiny', '--targets', targets.join(','));
  if (before) r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { [`f${n}.js`]: `// ${n}\n` })); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, lines); r.ok('review', rv);
  for (const [i, x] of Object.entries(r.state().entry.judged.alleged)) if (x.status === undefined) r.ok('reproduce', i, reproduce, ...(reproduce === 'no' ? ['--', 'node -e 1'] : ['--', 'node -e "process.exit(1)"']));
  return r.state();
}
const tiny = (r, targets, met, failed) => loop(r, targets, verdicts(r, met, failed), { before: targets.some((t) => r.state().failed.includes(t)) });
function breaker(r, targets, met, failed, { replan = null } = {}) { // one loop-breaker loop (level full, or a re-plan with the user's words)
  n++;
  if (replan) r.ok('replan', replan);
  const out = r.ok('call', 'breaker');
  r.prevent(replan ? 'replan' : 'full', '--targets', targets.join(','));
  if (replan) r.ok('approve', 'yes, go ahead');
  if (targets.some((t) => r.state().failed.includes(t))) r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(out, { [`b${n}.js`]: `// ${n}\n` })); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, verdicts(r, met, failed)); r.ok('review', rv);
  for (const i of failed) r.ok('reproduce', i, 'yes', '--', 'node -e "process.exit(1)"');
  return r.state();
}
function gate(r, met, failed = []) { // the release gate on HEAD
  r.ok('advance', 'GATE'); r.prevent(); r.ok('prune', 'none'); r.ok('run', '--e2e', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, verdicts(r, met, failed)); r.ok('review', rv);
  for (const i of failed) r.ok('reproduce', i, 'yes', '--', 'node -e "process.exit(1)"');
  return r.state();
}

// ── PLAN: a prevent, one block, then the split; the pre-freeze ───────────────────────────
test('M: the plan starts with a prevent (step back, then the one-block), traces goals to criteria and is frozen before the build', () => {
  const r = repo(); r.ok('init', 'FULL', 'demo', 'a small counter');
  r.writePlan(PLAN().replace(' | boundary: -h too', '').replace('C1, C2, C3', 'C1, C2'));
  r.refuse('planValid', /plan: C3: add "\| boundary[\s\S]*C3: no goal traces/, 'LOOP');
  r.writePlan(PLAN()); r.no(/PREVENT first: freeze in PLAN waits for the step back: node[\s\S]*the one-block: node/, 'freeze');
  r.no(/the step back comes first, then the one-block/, 'block', 'x');
  r.no(/covers the whole, without targets/, 'stepback', '--targets', 'C1', 'x');
  r.ok('stepback', 'the goals: a counter; unknown: none; risk: zero'); assert.equal(r.state().stepbacks[0].size, 'full', 'a FULL plan gets the full step back');
  r.refuse('planFrozen', /freeze the plan: node/, 'LOOP');
  r.ok('block', 'goals, design and acceptance: add.js; C1-C3'); r.no(/has its one-block/, 'block', 'again');
  assert.match(fs.readFileSync(path.join(r.d, 'cheapgpt', 'board.md'), 'utf8'), /## Next action \(the one-block\)\ngoals, design and acceptance/);
  assert.match(r.ok('freeze'), /advance LOOP starts the build/); r.ok('advance', 'LOOP');
});

test('M: after the pre-freeze only a re-plan with the user changes the list; a changed plan stops the next loop', () => {
  const r = repo(); r.ok('init', 'FULL', 'demo', 'a small counter'); r.prevent(); r.writePlan(PLAN()); r.ok('freeze');
  r.writePlan(PLAN().replace('C1, C2, C3', 'C1, C3').replace(/- C2 .*\n/, '')); r.no(/the user's \(removed: C2; the goals changed\)/, 'freeze');
  r.ok('freeze', '--user', 'drop C2, not needed'); assert.deepEqual(r.state().frozenSet.ids, ['C1', 'C3']); r.ok('advance', 'LOOP');
  r.writePlan(PLAN().replace('C1, C2, C3', 'C1, C3').replace(/- C2 .*\n/, '').replace('-h too', '-h and --usage'));
  r.no(/frozen since the build started: only a re-plan/, 'freeze');
  r.refuse('planUnchanged', /the plan changed since the freeze: node/, 'LOOP');
});

test('M: an existing project is adopted with a prevent and a baseline run, and its plan is reviewed once', () => {
  const r = repo({ existing: true }); r.ok('init', 'FOCUSED', 'demo', 'extend the counter');
  assert.equal(r.state().state, 'ADOPT');
  r.no(/PREVENT first: run in ADOPT waits for the step back: node[\s\S]*the one-block: node/, 'run', '--', 'node app.js');
  r.ok('stepback', 'the whole project: one file, no tests; risk: none');
  r.ok('block', 'what exists: app.js prints 1; no existing checks to protect; baseline: node app.js');
  r.refuse('baselineRun', /the baseline real run on HEAD: node/, 'PLAN');
  r.ok('run', '--', 'node app.js'); r.ok('advance', 'PLAN');
  r.prevent(); r.writePlan(PLAN()); r.ok('freeze');
  r.refuse('planReviewed:review', /the plan review: node/, 'LOOP');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, 'FIX: C2 boundary misses empty input'); r.ok('planreview', rv);
  r.refuse('planReviewed:fix', /apply the FIX once, then node/, 'LOOP'); r.no(/reviewed once/, 'planreview', rv);
  r.writePlan(PLAN().replace('"1e3" is a number', 'empty input is rejected')); r.ok('freeze'); r.ok('advance', 'LOOP');
});

// ── the tiny loop ────────────────────────────────────────────────────────────────────────
test('M: a tiny loop needs its prevent, disjoint committed builders, a merge, a run on HEAD, then a review', () => {
  const r = repo(); planned(r);
  r.refuse('prevented:loop', /LOOP → LOOP needs:\n- the step back: node[\s\S]*- the one-block: node/, 'LOOP'); // the exit checks the prevent again
  r.no(/PREVENT first: call builder in LOOP waits for the step back: node[\s\S]*the one-block/, 'call', 'dynamic');
  r.no(/builders build/, 'call', 'breaker');
  r.ok('stepback', 'tiny', '--targets', 'C1,C2', 'the whole: nothing built; build add; allocation dyn+mech'); r.no(/PREVENT first[\s\S]*one-block/, 'call', 'dynamic');
  r.ok('block', 'add.js: parse, validate, sum');
  const dOut = r.ok('call', 'dynamic'), mOut = r.ok('call', 'mechanical'); r.no(/already has its dynamic call/, 'call', 'dynamic');
  assert.match(fs.readFileSync(path.join(r.d, 'cheapgpt', 'runs', r.callId(dOut), 'packet.md'), 'utf8'), /^You are the dynamic builder[\s\S]*## The one-block \(build what it names\)\nadd\.js: parse, validate, sum\n\n## The assignment\n$/);
  r.no(/committed nothing/, 'merge', r.callId(dOut));
  const a = r.child(dOut, { 'app.js': 'a\n' }), b = r.child(mOut, { 'app.js': 'b\n', 'lib.js': 'l\n' });
  r.no(/both builders changed app.js: re-allocate disjoint paths in a new loop \(node/, 'merge', `${a},${b}`);
  r.no(/not a builder/, 'merge', 'deadbeef');
  const r3 = repo(); planned(r3); r3.prevent('tiny', '--targets', 'C1,C2');
  const x = r3.child(r3.ok('call', 'dynamic'), { 'app.js': 'a\n' }), y = r3.child(r3.ok('call', 'mechanical'), { 'lib.js': 'l\n' });
  r3.no(/merge the loop's work first/, 'call', 'reviewer');
  r3.ok('merge', `${x},${y}`); r3.no(/run the affected path on this commit/, 'call', 'reviewer');
  r3.refuse('loopReviewed', /this loop's review and its settled outcome: node[\s\S]*call reviewer/, 'LOOP');
  r3.ok('run', '--', 'node -e 1'); r3.commit('seam.js', 's'); r3.no(/run the affected path on this commit/, 'call', 'reviewer');
  r3.ok('run', '--', 'node -e 1'); fs.writeFileSync(path.join(r3.d, 'wip.js'), 'w'); r3.no(/wip\.js uncommitted: commit it first/, 'call', 'reviewer'); fs.rmSync(path.join(r3.d, 'wip.js'));
  const rv = r3.callId(r3.ok('call', 'reviewer'));
  r3.reply(rv, 'C1 | MET | evidence: printed 5 | counterfeit: none\nC2 | MET | evidence: e | counterfeit: c | boundary: b');
  r3.no(/C1: MET needs evidence, counterfeit and boundary[\s\S]*redispatch/, 'review', rv);
  r3.ok('redispatch', rv); r3.reply(rv, r3.met(['C1', 'C2'])); r3.ok('review', rv);
  const s = r3.state(); assert.equal(s.entry.judged.outcome, 'PASS'); assert.equal(s.base, s.entry.judged.sha); assert.deepEqual(s.est.sort(), ['C1', 'C2']);
});

test('M: FOCUSED loops get the root\'s mini-review, FULL loops a fresh reviewer', () => {
  const r = repo(); planned(r, { route: 'FOCUSED' });
  assert.match(r.ok('status'), /Mini-review \(FOCUSED\)/);
  r.prevent('tiny', '--targets', 'C1,C2'); r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'app.js': 'a\n' })); r.ok('run', '--', 'node -e 1');
  r.no(/on FOCUSED you review the loop yourself: your mini-review: cheapgpt\/mini\.md, then node/, 'call', 'reviewer');
  r.no(/write your verdict lines \(the mini-review card\) to cheapgpt\/mini\.md/, 'review', 'mini');
  fs.writeFileSync(path.join(r.d, 'cheapgpt', 'mini.md'), r.met(['C1'])); r.no(/C2: no verdict line[\s\S]*review mini/, 'review', 'mini');
  fs.writeFileSync(path.join(r.d, 'cheapgpt', 'mini.md'), verdicts(r, ['C1'], ['C2'])); r.ok('review', 'mini'); r.ok('reproduce', 'C2', 'yes', '--', 'node -e "process.exit(1)"');
  const s = r.state(); assert.equal(s.history[0].kind, 'mini'); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.ok(!fs.existsSync(path.join(r.d, 'cheapgpt', 'mini.md')), 'a mini-review is never reused');
  const f = repo(); planned(f); assert.doesNotMatch(f.ok('status'), /Mini-review/);
  f.prevent('tiny', '--targets', 'C1'); f.ok('merge', f.child(f.ok('call', 'dynamic'), { 'app.js': 'a\n' })); f.ok('run', '--', 'node -e 1');
  f.no(/a FULL loop gets a fresh review: node/, 'review', 'mini');
});

test('M: a review is void when the repository changes during it; a second incomplete reply blocks, and the re-plan starts from BASE in the same loop', () => {
  const r = repo(); planned(r);
  r.prevent('tiny', '--targets', 'C1');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'app.js': 'a\n' })); r.ok('run', '--', 'node -e 1');
  const base = r.state().base, rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1']));
  fs.writeFileSync(path.join(r.d, 'app.js'), 'changed by reviewer\n'); r.no(/changed during the review: void/, 'review', rv);
  r.ok('git', 'checkout', '-q', '--', 'app.js'); r.ok('redispatch', rv); r.reply(rv, 'nothing');
  r.no(/blocked → a re-plan with the user \(node/, 'review', rv);
  const s = r.state(); assert.equal(s.level, 'replan'); assert.equal(s.entry.merged, null, 'the unjudged merge is dropped');
  assert.match(r.ok('git', 'rev-parse', 'HEAD'), new RegExp(base)); assert.match(s.notes.join('\n'), /blocked before its review; candidate saved in temporary\/rejected-/);
  r.ok('replan', '--targets', 'C1', 'the reviewer keeps failing; try a smaller scope'); r.ok('call', 'breaker');
});

// ── one features stage, one release gate ─────────────────────────────────────────────────
test('M: every item, core and non-core, is built in loops; one release gate runs end to end on the reviewed commit; ACCEPT delivers the gated commit', () => {
  const r = repo(); planned(r, { plan: PLAN(USER_C4) });
  tiny(r, ['C1', 'C2'], ['C1', 'C2'], []);
  r.refuse('allEstablished', /items still open: C3: another loop \(node/, 'GATE');
  r.ok('advance', 'LOOP'); r.no(/C4: judged by the user at ACCEPT, never in a loop/, 'stepback', 'tiny', '--targets', 'C4', 'x');
  tiny(r, ['C3'], ['C3'], []); r.ok('advance', 'GATE');
  r.refuse('gatePassed:review', /the release gate's settled review: node/, 'ACCEPT');
  r.refuse('gateSettled:review', /the gate's review and its settled outcome: node/, 'LOOP');
  r.no(/PREVENT first: run --e2e in GATE waits for the step back: node \.cheapgpt\/cheapgpt\.mjs stepback "<the whole>"[\s\S]*the one-block/, 'run', '--e2e', '--', 'node -e 1');
  r.prevent(); r.ok('run', '--e2e', '--', 'node -e 1'); r.no(/records its prune first/, 'call', 'reviewer');
  r.ok('prune', 'none'); r.no(/end to end on this commit first/, 'call', 'reviewer'); // the e2e run predates the prune
  r.ok('run', '--e2e', '--', 'node -e 1'); r.commit('docs.md', 'late doc'); r.no(/end to end on this commit first/, 'call', 'reviewer');
  r.ok('run', '--e2e', '--', 'node -e 1'); const rv = r.callId(r.ok('call', 'reviewer'));
  r.reply(rv, r.met(['C1', 'C2'])); r.no(/C3: no verdict line/, 'review', rv); r.ok('redispatch', rv);
  r.reply(rv, r.met(['C1', 'C2', 'C3'])); r.ok('review', rv);
  r.refuse('gateSettled:passed', /the release gate passed: node .* advance ACCEPT/, 'LOOP'); r.ok('advance', 'ACCEPT');
  r.refuse(['userAnswer', 'finalReport'], /user's reply: node[\s\S]*final report: node/, 'DONE');
  const fin = r.ok('report', '--final'); assert.match(fin, /Yours to judge:\n- C4 it is pleasant to use — add two numbers/); assert.doesNotMatch(fin, /Where the work is/);
  r.ok('answer', 'accepted'); r.commit('extra.md', 'after the gate');
  r.refuse('gatedHead', /is not the gated commit \w+: deliver the gated commit \(node/, 'DONE');
  r.ok('git', 'reset', '-q', '--hard', 'HEAD~1'); r.ok('advance', 'DONE'); r.ok('clean');
  assert.ok(!fs.existsSync(path.join(r.d, 'cheapgpt', 'state.json')) && !fs.existsSync(path.join(r.d, 'temporary')));
});

test('M: a gate REGRESSION un-establishes the item and returns to tiny loops; NOT_MET dismissed establishes; missing evidence stays open without being a defect', () => {
  const r = repo(); planned(r);
  tiny(r, ['C1', 'C2', 'C3'], ['C1', 'C2', 'C3'], []);
  let s = gate(r, ['C2', 'C3'], ['C1']); assert.equal(s.history[1].outcome, 'REGRESSION'); assert.equal(s.level, 'tiny'); assert.ok(!s.est.includes('C1'));
  r.refuse('gatePassed:failed', /the gate did not pass: a loop on its failures \(node/, 'ACCEPT'); r.ok('advance', 'LOOP'); assert.deepEqual(r.state().targets, ['C1']);
  const d = repo(); planned(d); s = loop(d, ['C1'], d.notMet('C1'), { reproduce: 'no' });
  assert.equal(s.history[0].outcome, 'PASS'); assert.ok(s.est.includes('C1'));
  const x = repo(); planned(x); x.prevent('tiny', '--targets', 'C1,C2');
  x.ok('merge', x.child(x.ok('call', 'dynamic'), { 'a.js': 'a\n' })); x.ok('run', '--', 'node -e 1');
  const rx = x.callId(x.ok('call', 'reviewer')); x.reply(rx, verdicts(x, ['C1'], ['C2'])); x.ok('review', rx);
  x.no(/yes\|no \[--judgment\] -- <command>/, 'reproduce', 'C2', 'maybe', 'x'.repeat(20));
  x.no(/does not show "yes"[\s\S]*--judgment/, 'reproduce', 'C2', 'yes', '--', 'node -e 1'); // a passing run cannot reproduce a violation
  x.ok('reproduce', 'C2', 'missing', 'the 8-minute deciding run could not be made in the review');
  s = x.state(); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.ok(!s.est.includes('C2')); assert.ok(!s.failed.includes('C2'), 'missing is not a defect');
  assert.match(x.ok('report'), /C2 \| CORE \| open \(evidence missing\)/);
  x.ok('advance', 'LOOP'); x.prevent('tiny', '--targets', 'C2');
  x.ok('merge', x.child(x.ok('call', 'mechanical'), { 'clock.js': 'c\n' })); // no run --before owed: nothing was reproduced
});

// ── the ladder, per level (the section's outcome table) ──────────────────────────────────
test('M: tiny STALLED stays once, the 2nd → full; a dropped candidate is saved and the product reset to BASE; full PASS → tiny', () => {
  const r = repo(); planned(r);
  let s = tiny(r, ['C1', 'C2'], ['C2'], ['C1']); assert.equal(s.history[0].outcome, 'ADVANCED'); assert.equal(s.level, 'tiny');
  r.ok('advance', 'LOOP'); r.prevent('tiny', '--targets', 'C1');
  r.no(/C1 failed before: reproduce on BASE/, 'merge', 'x'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'g.js': 'g\n' })); r.ok('run', '--', 'node -e 1');
  let rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.notMet('C1')); r.ok('review', rv); r.ok('reproduce', 'C1', 'yes', '--', 'node -e "process.exit(1)"');
  s = r.state(); assert.equal(s.history[1].outcome, 'STALLED'); assert.equal(s.level, 'tiny'); assert.equal(s.count.STALLED, 1);
  assert.ok(s.history[1].saved && fs.existsSync(path.join(r.d, s.history[1].saved)), 'the dropped candidate is saved'); assert.match(r.ok('git', 'rev-parse', 'HEAD'), new RegExp(s.base));
  r.ok('advance', 'LOOP'); s = tiny(r, ['C1'], [], ['C1']); assert.equal(s.history[2].outcome, 'STALLED'); assert.equal(s.level, 'full'); assert.equal(s.count.STALLED, 0);
  r.ok('advance', 'LOOP'); r.no(/loop-breaker builds alone/, 'call', 'dynamic');
  const br = r.ok('call', 'breaker'), bid = r.child(br, { 'h.js': 'h\n' }); // the loop-breaker's call is the one step before its prevent
  r.no(/PREVENT first: merge in LOOP waits for the step back: node .*stepback full --targets[\s\S]*the loop-breaker's, recorded by you/, 'merge', bid);
  r.prevent('full', '--targets', 'C1'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', bid); r.ok('run', '--', 'node -e 1'); rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.met(['C1'])); r.ok('review', rv);
  s = r.state(); assert.equal(s.history[3].outcome, 'PASS'); assert.equal(s.level, 'tiny'); assert.deepEqual(s.count, { ADVANCED: 0, STALLED: 0, REGRESSION: 0 });
});

test('M: tiny ADVANCED stays twice, the 3rd → full; full ADVANCED → tiny', () => {
  const r = repo(); planned(r, { extra: ['C5', 'C6', 'C7'] });
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

test('M: with every item established, the loop-breaker has nothing to fix: the refusal names the release gate', () => {
  const r = repo(); planned(r);
  tiny(r, ['C1', 'C2', 'C3'], ['C1', 'C2', 'C3'], []); r.ok('advance', 'LOOP');
  tiny(r, ['C1'], [], ['C1']); r.ok('advance', 'LOOP'); const s = tiny(r, ['C1'], [], ['C1']);
  assert.equal(s.history[2].outcome, 'REGRESSION'); assert.equal(s.level, 'full'); assert.deepEqual(s.est.sort(), ['C1', 'C2', 'C3'], 'BASE kept every item');
  r.ok('advance', 'LOOP'); r.no(/every item is established: nothing for the loop-breaker to fix; the release gate: node .* advance GATE/, 'call', 'breaker');
  r.refuse('prevented:gate', /LOOP → GATE needs:\n- the step back: node[\s\S]*- the one-block: node/, 'GATE'); // the exit checks the prevent again
  r.prevent('full', '--targets', 'C1'); r.ok('advance', 'GATE');
});

// ── the re-plan: two decisions of the user's ─────────────────────────────────────────────
test('M: a first STALLED stays tiny; a re-plan needs the user\'s words, the loop-breaker\'s prevent, a frozen plan and approval; a no starts it again; the user may stop', () => {
  const r = repo(); planned(r);
  let s = tiny(r, ['C1'], [], ['C1']); assert.equal(s.history[0].outcome, 'STALLED'); assert.equal(s.level, 'tiny', 'no shortcut: the outcome table decides');
  r.refuse('userStops', /STOPPED only on the user's words at a re-plan: node/, 'STOPPED');
  r.ok('advance', 'LOOP'); r.ok('blocked', 'the environment stops the work'); assert.equal(r.state().level, 'replan');
  r.no(/re-plan starts with the user's words/, 'call', 'breaker');
  r.no(/level replan: .*stepback replan/, 'stepback', 'tiny', '--targets', 'C1', 'x');
  r.ok('replan', 'keep zero valid; try integer parsing');
  const br = r.ok('call', 'breaker'); const early = r.child(br, { 'early.js': 'e\n' });
  r.no(/PREVENT first: approve in LOOP waits for the step back/, 'approve', 'yes');
  r.prevent('replan', '--targets', 'C1');
  r.writePlan(PLAN().replace('add(0,0) prints 0', 'add(0,0) prints 0 and add(-1,1) prints 0')); r.no(/freeze the new plan first/, 'approve', 'yes');
  r.no(/the user's \(the build has started\)/, 'freeze'); r.ok('freeze', '--user', 'integers only');
  r.ok('replan', 'no: keep floats and fix the rounding'); // the user said no to the plan: their new comment starts the re-plan again
  assert.equal(r.state().entry.prevent, null, 'the new comment owes a new prevent'); r.prevent('replan', '--targets', 'C1');
  r.ok('approve', 'yes'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.no(/commits from before the user approved[\s\S]*git reset --hard/, 'merge', early);
  const wt = path.join(r.d, br.match(/^worktree: (\S+)/m)[1]); spawnSync('git', ['reset', '-q', '--hard', r.state().base], { cwd: wt });
  r.child(br, { 'after.js': 'a\n' }); r.ok('merge', early);
  const st = repo(); planned(st); st.ok('blocked', 'stuck'); st.ok('replan', '--targets', 'C1', 'stop the task'); st.ok('advance', 'STOPPED'); st.ok('clean');
  const g = repo(); planned(g); tiny(g, ['C1'], [], ['C1']); g.ok('advance', 'LOOP'); g.ok('blocked', 'stuck');
  s = breaker(g, ['C1'], ['C1'], [], { replan: 'try integer parsing' });
  assert.equal(s.history[1].outcome, 'PASS'); assert.equal(s.level, 'tiny'); assert.deepEqual(s.count, { ADVANCED: 0, STALLED: 0, REGRESSION: 0 });
});

// ── the task's own git store, when .git refuses the method's writes ──────────────────────
const asNobody = process.getuid && process.getuid() === 0 && spawnSync('runuser', ['--help']).status === 0;
const nobody = (d, ...x) => spawnSync('runuser', ['-u', 'nobody', '--', 'node', '.cheapgpt/cheapgpt.mjs', ...x], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d } });
test('M: init probes the writes it makes; when .git refuses them the task gets its own store that keeps the checkout\'s HEAD, cannot push, and is probed again', { skip: !asNobody && 'needs root and runuser to drop privileges' }, () => {
  const r = repo({ existing: true });
  spawnSync('chown', ['-R', 'nobody', r.d]);
  // the observed sandbox: refs/heads and worktrees writable, so a branch ref and a detached worktree pass; .git itself, info/ and config refuse writes
  fs.mkdirSync(path.join(r.d, '.git', 'worktrees'), { recursive: true }); spawnSync('chown', ['-R', 'nobody', path.join(r.d, '.git', 'worktrees')]);
  for (const p of ['.git', '.git/info', '.git/config']) fs.chmodSync(path.join(r.d, p), fs.statSync(path.join(r.d, p)).isDirectory() ? 0o555 : 0o444);
  const old = spawnSync('runuser', ['-u', 'nobody', '--', 'sh', '-c', 'git -c safe.directory=* update-ref refs/heads/cg-probe HEAD && echo REF-OK'], { cwd: r.d, encoding: 'utf8' });
  assert.match(old.stdout, /REF-OK/, 'a ref-only probe would have passed here');
  const out = nobody(r.d, 'init', 'FOCUSED', 'demo', 'extend the counter');
  assert.equal(out.status, 0, out.stdout + out.stderr); assert.match(out.stdout, /refuses the writes the method makes here \(the task branch: [^)]*\): the repository lives in cheapgpt\/git/);
  assert.match(out.stdout, /STATE ADOPT .* · git: cheapgpt\/git \(node \.cheapgpt\/cheapgpt\.mjs git <args>\)/);
  assert.equal(nobody(r.d, 'git', 'remote').stdout.trim(), '', 'no remote: nothing in the store can push to the user\'s repository');
  assert.equal(nobody(r.d, 'git', 'config', 'core.bare').stdout.trim(), 'false');
  assert.doesNotMatch(nobody(r.d, 'git', 'status', '--porcelain').stdout, /\.cheapgpt|cheapgpt\//, 'the tool\'s own files are excluded');
  const wt = nobody(r.d, 'git', 'worktree', 'add', '-q', '-b', 'cg/check', 'cheapgpt/wt/check', 'HEAD'); assert.equal(wt.status, 0, wt.stdout + wt.stderr);
  const w = repo(); w.ok('init', 'FOCUSED', 'demo', 'writable'); assert.ok(!fs.existsSync(path.join(w.d, 'cheapgpt', 'git')), 'a writable .git stays in use');
  assert.doesNotMatch(w.ok('git', 'branch', '--list', 'cg/probe-*'), /probe/, 'the probe leaves nothing behind');

  const L = repo({ existing: true }), lw = L.d + '-feature'; // a linked worktree on its own branch, ahead of main
  L.g('worktree', 'add', '-q', '-b', 'feature', lw); fs.writeFileSync(path.join(lw, 'feature.js'), 'f\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'feature.js'], { cwd: lw }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature'], { cwd: lw });
  fs.cpSync(path.join(L.d, '.cheapgpt'), path.join(lw, '.cheapgpt'), { recursive: true });
  const tip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: lw, encoding: 'utf8' }).stdout.trim();
  spawnSync('chown', ['-R', 'nobody', L.d, lw]); spawnSync('chmod', ['-R', 'a-w', path.join(L.d, '.git')]);
  const lo = nobody(lw, 'init', 'FOCUSED', 'demo', 'from a linked worktree'); assert.equal(lo.status, 0, lo.stdout + lo.stderr); assert.match(lo.stdout, /lives in cheapgpt\/git/);
  assert.equal(nobody(lw, 'git', 'rev-parse', 'HEAD').stdout.trim(), tip, 'the store starts at the linked worktree\'s commit');
  assert.equal(nobody(lw, 'git', 'status', '--porcelain', '--', 'app.js', 'feature.js').stdout.trim(), '', 'the files on disk match the store');

  const B = repo({ existing: true }); fs.mkdirSync(path.join(B.d, 'cheapgpt', 'wt'), { recursive: true }); // both refuse: worktrees cannot be made
  spawnSync('chown', ['-R', 'nobody', B.d]); spawnSync('chown', ['root', path.join(B.d, 'cheapgpt', 'wt')]); spawnSync('chmod', ['-R', 'a-w', path.join(B.d, '.git')]);
  const bo = nobody(B.d, 'init', 'FOCUSED', 'demo', 'nothing writable');
  assert.notEqual(bo.status, 0); assert.match(bo.stderr, /in \.git \([^)]*\) and in cheapgpt\/git \(a worktree: [^)]*\); cheapgpt\/git was removed and the task folder kept/);
  assert.ok(!fs.existsSync(path.join(B.d, 'cheapgpt', 'git')) && fs.existsSync(path.join(B.d, 'cheapgpt')));
});

// ── cards and flow as data ───────────────────────────────────────────────────────────────
test('M: the flow validator accepts the shipped flow', () => {
  const r = repo(); assert.match(r.cg('check').out, /FLOW OK: 7 states[\s\S]*19 cards, each bound/);
});

test('M: every state, level, role and route has its card; a missing, unbound or drifted card fails the check and the status names the fix', () => {
  const r = repo(); assert.match(r.ok('check'), /FLOW OK/);
  r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  assert.match(r.ok('status'), /CARD\nThe plan is one block first, split second[\s\S]*The step back: look at the whole[\s\S]*The one-block: after the step back/);
  const cards = path.join(r.d, '.cheapgpt', 'cards');
  fs.renameSync(path.join(cards, 'plan.md'), path.join(r.d, 'plan.card'));
  r.no(/card "plan" \(PLAN, root\) is missing[\s\S]*install\.mjs update/, 'status');
  assert.match(r.cg('check').out, /card "plan" missing/);
  fs.renameSync(path.join(r.d, 'plan.card'), path.join(cards, 'plan.md'));
  fs.writeFileSync(path.join(cards, 'orphan.md'), '---\ncard: orphan\nstate: PLAN\nrole: root\nloads: never\n---\nnothing binds me\n');
  assert.match(r.cg('check').out, /card "orphan" \(orphan\.md\) is bound to nothing/); fs.rmSync(path.join(cards, 'orphan.md'));
  const merge = path.join(cards, 'merge.md'); fs.writeFileSync(merge, fs.readFileSync(merge, 'utf8').replace('level: tiny', 'level: full'));
  assert.match(r.cg('check').out, /card "merge": front matter \(LOOP\/full\/root\) differs from flow\.json \(LOOP\/tiny\/root\)/);
  const mini = path.join(cards, 'mini-review.md'); fs.writeFileSync(mini, fs.readFileSync(mini, 'utf8').replace('route: FOCUSED', 'route: FULL'));
  assert.match(r.cg('check').out, /card "mini-review": front matter \(LOOP\/root\/FULL\) differs from flow\.json \(LOOP\/root\/FOCUSED\)/);
  const flow = path.join(r.d, '.cheapgpt', 'flow.json'); fs.writeFileSync(flow, fs.readFileSync(flow, 'utf8').replace('"GATE": ["prune",', '"GATE": ["answer", "prune",'));
  assert.match(r.cg('check').out, /prevent GATE: answer is not a command of GATE/);
});

test('M: each call writes its role card into the packet; the loop-breaker also gets the step back and the one-block', () => {
  const r = repo(); planned(r);
  r.prevent('tiny', '--targets', 'C1');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'a.js': 'a\n' })); r.ok('run', '--', 'node -e 1');
  const rv = r.ok('call', 'reviewer'); assert.match(fs.readFileSync(path.join(r.d, 'cheapgpt', 'runs', r.callId(rv), 'packet.md'), 'utf8'), /^You are a fresh read-only reviewer[\s\S]*<ID> \| MET \| evidence:[\s\S]*Noise:[\s\S]*Extras:/);
  const g = repo(); planned(g); g.ok('blocked', 'stuck'); g.ok('replan', '--targets', 'C1', 'try integer parsing');
  const br = fs.readFileSync(path.join(g.d, 'cheapgpt', 'runs', g.callId(g.ok('call', 'breaker')), 'packet.md'), 'utf8');
  assert.match(br, /^You are the loop-breaker[\s\S]*The step back: look at the whole[\s\S]*The one-block: after the step back/); assert.doesNotMatch(br, /## The one-block \(build what it names\)/);
});

test('M: computed signals inform without blocking: the same criterion failing again, a diff growing while nothing is established', () => {
  const r = repo(); planned(r);
  tiny(r, ['C1', 'C2'], ['C2'], ['C1']); r.ok('advance', 'LOOP');
  r.prevent('tiny', '--targets', 'C1'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'x.js': 'x\n' })); r.ok('run', '--', 'node -e 1');
  let rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.notMet('C1')); r.ok('review', rv);
  const out = r.ok('reproduce', 'C1', 'yes', '--', 'node -e "process.exit(1)"');
  assert.match(out, /SIGNALS \(computed; information, never a block\)\n- the same criterion failing again: C1 \(2×\)/);
  r.ok('advance', 'LOOP'); // the signal does not block
  r.prevent('tiny', '--targets', 'C1'); r.ok('run', '--before', '--', 'node -e "process.exit(1)"');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'y.js': 'y\ny\ny\ny\ny\n', 'z.js': 'z\nz\nz\n' })); r.ok('run', '--', 'node -e "process.exit(3)"');
  rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.notMet('C1')); r.ok('review', rv);
  const third = r.ok('reproduce', 'C1', 'yes', '--', 'node -e "process.exit(1)"');
  assert.match(third, /a diff growing while nothing is established \(1 → 8 lines\)/);
  const g = repo(); planned(g); g.prevent('tiny', '--targets', 'C1');
  g.ok('merge', g.child(g.ok('call', 'dynamic'), { 'a.js': 'a\n' })); g.ok('run', '--', 'node -e "process.exit(1)"');
  const gv = g.callId(g.ok('call', 'reviewer')); g.reply(gv, g.met(['C1']));
  assert.match(g.ok('review', gv), /checks green while the real run fails: the run on \w+ exited non-zero, yet C1 were judged MET/);
});

test('M: a refusal for a command in the wrong state names where it belongs and how to see the next step', () => {
  const r = repo(); r.ok('init', 'FOCUSED', 'demo', 'a small counter');
  r.no(/merge belongs to LOOP; this task is in PLAN: node \.cheapgpt\/cheapgpt\.mjs status shows/, 'merge', 'x');
  r.no(/answer belongs to ACCEPT; this task is in PLAN/, 'answer', 'yes');
  r.no(/run --e2e belongs to GATE/, 'run', '--e2e', '--', 'node -e 1');
  r.no(/review mini belongs to LOOP/, 'review', 'mini');
});

test('M: reproduce is witnessed: the engine runs the command, and its exit must match the verdict unless judged on its output', () => {
  const r = repo(); planned(r); r.prevent('tiny', '--targets', 'C1');
  r.ok('merge', r.child(r.ok('call', 'dynamic'), { 'a.js': 'a\n' })); r.ok('run', '--', 'node -e 1');
  const rv = r.callId(r.ok('call', 'reviewer')); r.reply(rv, r.notMet('C1')); r.ok('review', rv);
  r.no(/the run exited 0, which does not show "yes"/, 'reproduce', 'C1', 'yes', '--', 'node -e 1');
  r.no(/the run exited 3, which does not show "no"/, 'reproduce', 'C1', 'no', '--', 'node -e "process.exit(3)"');
  r.ok('reproduce', 'C1', 'no', '--judgment', '--', 'node -e "console.log(5); process.exit(3)"');
  const s = r.state(), runs = s.runs.filter((x) => x.kind === 'reproduce');
  assert.equal(runs.length, 3, 'every reproduction is recorded as a run'); assert.match(s.history[0].alleged.C1.evidence, /exit 3 \(judged on its output\)/);
  assert.equal(s.history[0].outcome, 'PASS');
});

// ── a task started on 1.10.0 continues ───────────────────────────────────────────────────
test('M: a task started on 1.10.0 (core and non-core stages) migrates on load and continues on one features stage', () => {
  const r = repo(); planned(r); tiny(r, ['C1', 'C2'], ['C1'], ['C2']);
  const f = path.join(r.d, 'cheapgpt', 'state.json'), s = r.state(); // rewrite it in the exact shape the 1.10.0 engine writes
  const KEYS = ['version', 'route', 'slug', 'reason', 'state', 'adopted', 'stage', 'entry', 'adopt', 'planReview', 'frozen', 'frozenT', 'frozenSet', 'hard', 'est', 'failed', 'targets', 'level', 'count', 'coreLoops', 'blocked', 'base', 'gateSha', 'stepbacks', 'history', 'vetoes', 'backlog', 'notes', 'calls', 'runs', 'snap'];
  const ENTRY = ['t', 'runs', 'judged', 'prevent', 'replan', 'approved', 'merged', 'calls', 'finalReport', 'answer'];
  const HIST = ['kind', 'stage', 'sha', 'scope', 'met', 'alleged', 't', 'outcome', 'established', 'diff', 'runFailed', 'firstCore', 'from', 'to'];
  const old = { ...s, version: '1.10.0', stage: 'CORE', adopt: 'app.js existed', hard: false, coreLoops: 1 };
  old.entry = Object.fromEntries(ENTRY.map((k) => [k, s.entry[k]])); old.history = s.history.map((h) => Object.fromEntries(HIST.map((k) => [k, k === 'stage' ? 'CORE' : k === 'firstCore' ? true : h[k]])));
  fs.writeFileSync(f, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, old[k]])), null, 2));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8'))), KEYS);
  assert.match(r.ok('status'), /STATE LOOP · FULL/);
  const m = r.state(); assert.equal(m.version, '1.10.3'); assert.ok(!('stage' in m) && !('hard' in m) && !('coreLoops' in m) && !('adopt' in m));
  assert.match(m.notes.join('\n'), /adoption record \(before 1\.10\.2\): app\.js existed/);
  assert.match(fs.readFileSync(path.join(r.d, 'cheapgpt', 'log.jsonl'), 'utf8'), /"ev":"migrate","from":"1\.10\.0","to":"1\.10\.3"/);
  r.ok('advance', 'LOOP'); tiny(r, ['C2', 'C3'], ['C2', 'C3'], []);
  assert.equal(gate(r, ['C1', 'C2', 'C3']).history[2].outcome, 'PASS'); r.ok('advance', 'ACCEPT');
});

test('M: a task saved by 1.10.2 mid-gate continues without a prevent; the next state entry owes one', () => {
  const r = repo(); planned(r); tiny(r, ['C1', 'C2', 'C3'], ['C1', 'C2', 'C3'], []);
  r.ok('advance', 'GATE'); r.prevent(); r.ok('prune', 'none'); r.ok('run', '--e2e', '--', 'node -e 1');
  const f = path.join(r.d, 'cheapgpt', 'state.json'), s = r.state(); // 1.10.2 had no prevent in GATE
  s.version = '1.10.2'; s.entry.prevent = null; s.entry.block = null; delete s.entry.legacy; fs.writeFileSync(f, JSON.stringify(s, null, 2));
  const rv = r.callId(r.ok('call', 'reviewer')); assert.equal(r.state().entry.legacy, true); assert.equal(r.state().version, '1.10.3');
  r.reply(rv, r.met(['C1', 'C2', 'C3'])); r.ok('review', rv); r.ok('advance', 'ACCEPT');
  const g = repo(); planned(g); // saved by 1.10.2 at the start of a loop: no prevent yet
  const t = JSON.parse(fs.readFileSync(path.join(g.d, 'cheapgpt', 'state.json'), 'utf8')); t.version = '1.10.2'; fs.writeFileSync(path.join(g.d, 'cheapgpt', 'state.json'), JSON.stringify(t));
  g.ok('status'); g.ok('advance', 'LOOP'); g.no(/PREVENT first: call builder in LOOP/, 'call', 'dynamic');
});

// ── the audit of this suite ──────────────────────────────────────────────────────────────
test('M: audit: every guard in flow.json is seen refusing, each assertion exactly once, at the transition it gates', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(SRC, 'flow.json'), 'utf8'));
  const guards = new Set(Object.values(flow.states).flatMap((st) => [...(st.exit || []), ...Object.values(st.to || {}).flat()]));
  for (const gd of guards) assert.ok(Object.keys(asserted).some((t) => t.split(':')[0] === gd), `${gd}: never seen refusing`);
  for (const [t, k] of Object.entries(asserted)) { assert.ok(guards.has(t.split(':')[0]), `${t}: not a guard in flow.json`); assert.equal(k, 1, `${t}: asserted ${k} times`); }
});
