#!/usr/bin/env node
// cheapGPT tool: the flow, the escalation ladder, BASE, the guards, the board and the reports.
// What can be computed is decided here; judgment stays with the agent; the user's decisions stay with the user.
// Node standard library only. Installed at .cheapgpt/cheapgpt.mjs; run from the repository root: node .cheapgpt/cheapgpt.mjs <command> ...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.9.0';
const ROOT = process.cwd();
const DIR = path.join(ROOT, 'cheapgpt');
const TMP = path.join(ROOT, 'temporary');
const F = { state: path.join(DIR, 'state.json'), log: path.join(DIR, 'log.jsonl'), board: path.join(DIR, 'board.md'), plan: path.join(DIR, 'plan.md') };
const METHOD_PATHS = ['.cheapgpt/', '.codex/', '.claude/', 'AGENTS.md', 'CLAUDE.md']; // the installed method, never part of the product
const CMD = 'node ' + (path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/') || 'cheapgpt.mjs'); // how this tool is invoked here
const TAGS = ['CORE', 'NON-CORE'];
const LEVELS = ['tiny', 'full', 'replan'];

// ── The flow: allowed next states and the card shown on entry ───────────────────────────────
const MERGE = `Merge guideline: merge only builder branches cut from BASE, each committed in its own worktree (${CMD} merge <ids>). Paths both builders touched mean the allocation was wrong: re-allocate, never hand-reconcile. After the merge you may commit only the seam (wiring, imports, a shared signature the handoffs fixed); anything else goes back to its builder. Then run the affected path on the merged HEAD.`;
const FLOW = {
  ADOPT: { next: ['PREFLIGHT'], card: `Existing project: understand it before planning; adoption never changes the product.
Read the history, the docs and the existing checks. Run the product's real path once on HEAD (run -- <command>) as the baseline.
${CMD} adopt "<what exists, what works on the baseline run, which existing checks are protected>"` },
  PREFLIGHT: { next: ['PLAN'], card: `Prove the roles before any product work.
P1 every child is spawned with an explicit model and reasoning effort from the roles table.
P2 each child's model and effort are confirmed from the harness record (the spawn call's arguments, the session or event log), never from its reply: ok, or requested when the record shows only the requested settings; fail stops that role (fix the spawn, or blocked).
P3 a reviewer call leaves the repository unchanged: call reviewer (packet: reply "READY", write nothing), then isolation.
Record P1 and P2: ${CMD} preflight P<n> ok|requested|fail "<evidence>".` },
  PLAN: { next: ['LOOP'], card: `Write cheapgpt/plan.md: ## Goals, ## Acceptance, ## Backlog, ## Drop, ## Mechanism, ## Handoffs.
Goal line: - G<n> | <the user's words> | <criterion IDs> (or Drop: <reason>)
Criterion line: - C<n> | CORE|NON-CORE | <one property> | run: <the real run that decides it> | boundary: <the closest input where a wrong result would still look right> [| judge: user — <what the user should try>]
FOCUSED: you write it. FULL: the planner writes it. Then ${CMD} freeze (provisional until the core gate passes).
Adopted project: plan review by a fresh reviewer (call reviewer; its reply opens with PASS or FIX), then planreview <id>; a FIX is applied once, then freeze again.` },
  LOOP: { next: ['LOOP', 'GATE', 'STOPPED'], card: '' }, // the card depends on the level (LOOP_CARD)
  GATE: { next: ['LOOP', 'GATE', 'ACCEPT'], card: `Certify the stage on one commit.
Core gate: scope CORE. Release gate: scope everything; first remove what does not trace (LAW 4) and record it: prune "<what was removed>" or prune none; commit.
Then run --e2e -- <the product end to end, on its normal path and speed> on that commit, call reviewer, review <id>, reproduce every NOT_MET. Any later commit, docs included, repeats the e2e run and the review.
PASS: core gate → NON-CORE stage (the acceptance list freezes hard); release gate → ACCEPT. Otherwise the failing criteria become the next loop's targets.` },
  ACCEPT: { next: ['DONE', 'LOOP'], card: `The release gate passed: deliver to the user.
${CMD} report --final opens your message: the split acceptance table and each criterion left to the user's judgment with what to try.
Record the user's reply: answer "<their words>". Acceptance → advance DONE. Feedback → advance LOOP (a re-plan seeded by their words).` },
  DONE: { next: [], terminal: true, card: `Done. Unless the user asked to keep them: ${CMD} clean.
Issue report, only after a task that reached a full step back or a re-plan: a project-neutral draft in cheapgpt/reports/ (no code, paths, names or secrets) naming the method element that was missing, misleading or wrong, its evidence, and one change that removes or sharpens before it adds. The change must hold for every project the method serves: a law, veto, signal, flow step or guard stated without this project's domain, never a rewording of a rule that already covers the case, and never a fix for a single judgment slip the existing rule already covered. Show it; file it (gh issue create --repo <ISSUE_REPO>) only on the user's yes.` },
  STOPPED: { next: [], terminal: true, card: 'Stopped by the user: report BASE, the reproducible open cases, what is needed, and the options.' },
};
const STEP_BACK = `The step back (one method, three sizes): look at the whole before the detail. Restate the goal and the targets' literal criteria; read all the evidence (every run, finding, review and dropped attempt so far), not the latest detail; name the class of failure and the root cause it shares, in the problem, never in the last fix. Consider removal first: what can be deleted or simplified instead of added? Check that the evidence shows the real property, not a look-alike. Then one correction at the origin, stated as the rule for the whole property, and its smallest coherent move.`;
const LOOP_CARD = {
  tiny: `Tiny loop (level tiny): one behaviour to build or fix, on BASE.
1 PREVENT: the root's step back, in a few lines: stepback tiny --targets <IDs> "<the whole, the class and root cause, what to remove, the real property, the one correction, the allocation>". A target that already failed: reproduce it on BASE (run --before -- <command>; --judgment when the evidence is the criterion's real output).
2 BUILD: call dynamic and/or call mechanical (one each at most, disjoint paths); each commits in its own worktree. Never spawn an idle builder.
3 MERGE (guideline below), then run -- <the affected path> on HEAD.
4 REVIEW: call reviewer, review <id>, reproduce every NOT_MET. The tool gives the outcome and the next level.`,
  full: `Full step back (level full): a fresh loop-breaker takes the step back in a few paragraphs, then builds alone.
1 call breaker: a self-contained packet (plan, vetoes, BASE and its diff, every real-run result, finding and dropped attempt, your own reading labelled an unverified hypothesis). It takes the step back from scratch, names the step at fault (brief, mechanism, plan or structure), then builds one fix on its strongest hypothesis in its worktree. A target that already failed: run --before on BASE.
2 Record its step back: stepback full --targets <IDs> "<the whole, the class and root cause, the step at fault, what it removes, the correction>".
3 merge <id>, run the affected path, then call reviewer, review, reproduce.`,
  replan: `Re-plan (level replan): the full step back, with the user deciding.
1 Show the user the targets, what was tried, the evidence and 2-3 options with your recommendation. Record their words: replan [--targets <IDs>] "<their comment>". "stop" → advance STOPPED.
2 call breaker: the loop-breaker takes the full step back with the user's comment and rewrites the plan from the step at fault. Record its step back (stepback replan --targets <IDs> "..."); write the new plan to cheapgpt/plan.md and freeze (--user "<their words>" for a changed goal, a removed criterion, or any change after the hard freeze).
3 Show the user the step back and the new plan; record their approval: approve "<their words>". Only then the same loop-breaker builds in its worktree; run --before on BASE for a target that already failed.
4 merge <id>, run the affected path, then call reviewer, review, reproduce.`,
};
const REVIEW_FORMAT = `Reviewer reply, one line per criterion in scope:
<ID> | MET | evidence: <run or output> | counterfeit: <the look-alike excluded> | boundary: <boundary case run, and its result>
<ID> | NOT_MET | case: <input; command; observed output>`;

// ── State, log, git ────────────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();
const die = (msg) => { console.error('REFUSED: ' + msg); process.exit(2); };
const load = () => { if (!fs.existsSync(F.state)) die(`no task: ${CMD} init <FOCUSED|FULL> <slug> "<reason>"`); return JSON.parse(fs.readFileSync(F.state, 'utf8')); };
function save(s, event) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F.state, JSON.stringify(s, null, 2));
  if (event) fs.appendFileSync(F.log, JSON.stringify({ t: now(), state: s.state, level: s.level, ...event }) + '\n');
  fs.writeFileSync(F.board, board(s));
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd || ROOT, maxBuffer: 1 << 26, shell: !!opts.shell, timeout: opts.timeout, env: opts.env || process.env });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}
const ident = ['-c', 'user.name=cheapgpt', '-c', 'user.email=cheapgpt@localhost'];
const gitDirArgs = () => fs.existsSync(path.join(DIR, 'git')) ? ['--git-dir=' + path.join(DIR, 'git'), '--work-tree=' + ROOT] : [];
let hasId = null; // commits need an identity; a fresh sandbox may have none
function git(args, cwd) {
  if (hasId === null) hasId = !!sh('git', ['config', 'user.email']).out.trim();
  return sh('git', ['-c', 'safe.directory=*', ...(hasId ? [] : ident), ...(cwd ? [] : gitDirArgs()), ...args], { cwd });
}
const head = (cwd) => git(['rev-parse', 'HEAD'], cwd).out.trim();
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const product = (line) => { const p = line.slice(3).trim().replace(/^"|"$/g, ''); return !METHOD_PATHS.some((m) => p === m.replace(/\/$/, '') || p.startsWith(m)); };
const dirty = () => git(['status', '--porcelain']).out.split('\n').filter((l) => l.trim() && product(l));
const snapshot = () => ({ head: head(), status: dirty().join('\n'), diff: sha256(git(['diff']).out), t: now() });
const sameTree = (a, b) => a.head === b.head && a.status === b.status && a.diff === b.diff;
function gitUsable(slug) { // make the very writes the method needs, never a proxy: the exclude file, the task branch checked out, a cg/ worktree and a commit in it
  if (!fs.existsSync(path.join(ROOT, '.git')) && git(['init', '-b', 'main']).code) return false;
  if (git(['rev-parse', '--verify', 'HEAD']).code && git(['commit', '--allow-empty', '-m', 'cheapGPT baseline']).code) return false;
  const gd = git(['rev-parse', '--git-dir']).out.trim(); if (!gd) return false;
  try { const ex = path.resolve(ROOT, gd, 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, ''); } catch { return false; }
  if (git(['checkout', '-q', '-B', 'cg/' + slug]).code) return false;
  const tag = crypto.randomBytes(3).toString('hex'), br = 'cg/probe-' + tag, wt = path.join(DIR, 'wt', 'probe-' + tag);
  const ok = !git(['worktree', 'add', '-q', '-b', br, wt, 'HEAD']).code && !git(['commit', '-q', '--allow-empty', '-m', 'cheapGPT probe'], wt).code;
  git(['worktree', 'remove', '--force', wt]); git(['branch', '-q', '-D', br]); git(['worktree', 'prune']); fs.rmSync(wt, { recursive: true, force: true });
  return ok;
}

// ── The plan: goals mapped to criteria, criteria with their deciding run and boundary ────
function section(text, name) {
  const start = text.search(new RegExp(`^## ${name}\\s*$`, 'm')); if (start < 0) return null;
  const body = text.slice(start).split('\n').slice(1), end = body.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? body : body.slice(0, end)).map((l) => l.trim()).filter((l) => l.startsWith('- '));
}
function plan() {
  if (!fs.existsSync(F.plan)) return { crit: [], goals: [], errors: ['cheapgpt/plan.md is missing'], hash: null };
  const text = fs.readFileSync(F.plan, 'utf8'), errors = [], crit = [], goals = [];
  const cl = section(text, 'Acceptance'), gl = section(text, 'Goals');
  if (!cl) errors.push('no "## Acceptance" section'); if (!gl) errors.push('no "## Goals" section');
  for (const raw of cl || []) {
    const parts = raw.slice(2).split(' | ').map((p) => p.trim()), [id, tag, property] = parts;
    const field = (k) => (parts.find((p) => p.startsWith(k + ':')) || '').slice(k.length + 1).trim();
    const c = { id, tag, property, run: field('run'), boundary: field('boundary'), user: /^user\b/i.test(field('judge')), raw };
    if (!id || !TAGS.includes(tag) || !property) { errors.push(`"${raw.slice(0, 50)}…" needs "<ID> | CORE|NON-CORE | <property>"`); continue; }
    if (!c.run) errors.push(`${id}: missing run:`); if (!c.boundary) errors.push(`${id}: missing boundary:`);
    if (crit.some((x) => x.id === id)) errors.push(`${id}: duplicate ID`);
    crit.push(c);
  }
  for (const raw of gl || []) {
    const [gid, words, map] = raw.slice(2).split(' | ').map((p) => p.trim());
    if (!gid || !words || !map) { errors.push(`goal "${raw.slice(0, 50)}…" needs "<G#> | <the user's words> | <IDs> or Drop: <reason>"`); continue; }
    const drop = /^Drop:\s*\S/.test(map), ids = drop ? [] : map.split(/[,\s]+/).filter(Boolean);
    for (const id of ids) if (!crit.some((c) => c.id === id)) errors.push(`${gid}: maps to unknown criterion ${id}`);
    if (!drop && !ids.length) errors.push(`${gid}: maps to nothing (criteria or Drop: <reason>)`);
    goals.push({ gid, raw, ids, drop });
  }
  for (const c of crit) if (!goals.some((g) => g.ids.includes(c.id))) errors.push(`${c.id}: no goal traces to it`);
  if (!crit.some((c) => c.tag === 'CORE' && !c.user)) errors.push('no CORE criterion a reviewer can decide');
  return { crit, goals, errors, hash: sha256([...(gl || []), ...(cl || [])].join('\n')) };
}
const reviewable = (s, tag) => plan().crit.filter((c) => !c.user && (tag === 'ALL' || c.tag === tag)).map((c) => c.id);
const stageScope = (s) => reviewable(s, s.stage);
const gateScope = (s) => reviewable(s, s.stage === 'CORE' ? 'CORE' : 'ALL');
const openInStage = (s) => stageScope(s).filter((id) => !s.est.includes(id));

// ── Guards: what a transition from the current state to `to` still needs ─────────────────
function needs(s, to) {
  const n = [], e = s.entry, P = plan(), j = e.judged;
  if (!FLOW[s.state].next.includes(to)) return [`${s.state} cannot go to ${to}; allowed: ${FLOW[s.state].next.join(', ') || 'none'}`];
  if (s.frozen && ['LOOP', 'GATE'].includes(s.state) && P.hash !== s.frozen) n.push('the plan changed since the freeze: freeze it (a re-plan, or --user)');
  switch (s.state) {
    case 'ADOPT':
      if (!e.runs.some((r) => r.kind === 'run')) n.push('the baseline real run on HEAD (run -- <command>)');
      if (!s.adopt) n.push('the adoption record (adopt "...")');
      break;
    case 'PREFLIGHT':
      if (s.preflight.P1 !== 'ok') n.push('P1 ok');
      if (!['ok', 'requested'].includes(s.preflight.P2)) n.push('P2 ok or requested');
      if (s.preflight.P3 !== 'ok') n.push('P3: call reviewer, then isolation');
      break;
    case 'PLAN':
      if (P.errors.length) n.push(...P.errors.map((x) => 'plan: ' + x));
      if (s.frozen !== P.hash) n.push(`freeze (${CMD} freeze)`);
      if (s.adopted) {
        if (!s.planReview) n.push('the plan review (call reviewer, then planreview <id>)');
        else if (s.planReview.verdict === 'FIX' && !(s.frozenT > s.planReview.t)) n.push('the FIX applied once, then freeze');
      }
      break;
    case 'LOOP':
      if (to === 'STOPPED') { if (!(s.level === 'replan' && e.replan)) n.push("STOPPED only on the user's words at a re-plan (replan \"...\")"); break; }
      if (!j || !j.outcome) n.push('the loop reviewed and its outcome settled (call reviewer, review, reproduce)');
      else if (to === 'GATE' && openInStage(s).length) n.push(`stage criteria still open: ${openInStage(s).join(', ')}`);
      else if (to === 'GATE' && s.level !== 'tiny') n.push(`level ${s.level}: the next loop first`);
      break;
    case 'GATE':
      if (!j || !j.outcome) n.push('the gate reviewed and its outcome settled');
      else if (j.outcome === 'PASS') {
        if (s.stage === 'NON-CORE' && j.stage === 'CORE' && to === 'ACCEPT') n.push('core gate passed: the NON-CORE stage comes first');
        if (j.stage === 'CORE' && to === 'GATE' && openInStage(s).length) n.push(`NON-CORE criteria open: ${openInStage(s).join(', ')}: LOOP`);
        if (j.stage === 'CORE' && to === 'LOOP' && !openInStage(s).length) n.push('no NON-CORE criterion open: GATE (the release gate)');
        if (j.stage === 'NON-CORE' && to !== 'ACCEPT') n.push('release gate passed: ACCEPT');
      } else if (to !== 'LOOP') n.push('a gate that did not pass opens a loop on its failures');
      break;
    case 'ACCEPT':
      if (!e.answer) n.push("the user's reply (answer \"...\")");
      if (to === 'DONE') {
        if (!e.finalReport) n.push('the final report (report --final)');
        if (head() !== s.gateSha) n.push(`HEAD ${head().slice(0, 7)} is not the gated ${(s.gateSha || 'none').slice(0, 7)}`);
      }
      break;
  }
  return n;
}
function loopGuard(s, what) { // the evidence a loop step owes before `what`
  const e = s.entry, P = plan();
  if (s.frozen && P.hash !== s.frozen) die('the plan changed since the freeze: freeze it first');
  if (s.state !== 'LOOP') return;
  if (s.level === 'tiny' && !e.prevent && what !== 'stepback') die('PREVENT first: stepback tiny --targets <IDs> "<what the evidence shows, the cause, the smallest move, the allocation>"');
  if (s.level === 'replan') {
    if (!e.replan) die('a re-plan starts with the user\'s words: replan "<their comment>"');
    if (what === 'merge' && !e.approved) die('the user reviews the new plan before anything is built: approve "<their words>"');
  }
  if (what === 'merge') {
    if (s.level === 'full' && !e.prevent) die('record the loop-breaker\'s diagnosis first: stepback full --targets <IDs> "..."');
    const tg = targets(s), failed = tg.filter((id) => s.failed.includes(id));
    if (failed.length && !e.runs.some((r) => r.kind === 'before' && (r.code !== 0 || r.judgment))) die(`${failed.join(', ')} failed before: reproduce on BASE first (run --before -- <command>, failing; --judgment when the evidence is the real output)`);
  }
}
const targets = (s) => (s.entry.prevent && s.entry.prevent.targets) || (s.entry.replan && s.entry.replan.targets) || s.targets;

// ── Review parsing, outcomes and the ladder ──────────────────────────────────────────────
function parseOut(file, ids) {
  if (!fs.existsSync(file)) return { incomplete: [`${rel(file)} not found`], v: {} };
  const v = {}, incomplete = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))) {
    const parts = line.split(' | ').map((p) => p.trim());
    if (!ids.includes(parts[0]) || !['MET', 'NOT_MET'].includes(parts[1])) continue;
    const val = (k) => { const p = parts.find((x) => x.startsWith(k + ':')); return p ? p.slice(k.length + 1).trim() : ''; };
    if (parts[1] === 'MET' && !(val('evidence') && val('counterfeit') && val('boundary'))) incomplete.push(`${parts[0]}: MET needs evidence, counterfeit and boundary`);
    if (parts[1] === 'NOT_MET' && !val('case')) incomplete.push(`${parts[0]}: NOT_MET needs case`);
    v[parts[0]] = parts[1];
  }
  for (const id of ids) if (!v[id]) incomplete.push(`${id}: no verdict line`);
  return { v, incomplete };
}
const LIMIT = { tiny: { ADVANCED: [3, 'full'], STALLED: [2, 'full'], REGRESSION: [2, 'full'] }, full: { ADVANCED: [1, 'tiny'], STALLED: [2, 'replan'], REGRESSION: [2, 'replan'] }, replan: { ADVANCED: [1, 'tiny'], STALLED: [1, 'replan'], REGRESSION: [1, 'replan'] } };
function ladder(s, j) { // outcomes counted per level since the last PASS or level change: the nth of a kind moves to the next level
  const o = j.outcome, from = s.level;
  if (o === 'PASS') { s.level = 'tiny'; s.count = { ADVANCED: 0, STALLED: 0, REGRESSION: 0 }; return; }
  s.count[o]++;
  const [n, to] = LIMIT[from][o];
  const next = j.firstCore && o === 'STALLED' ? 'replan' : s.count[o] >= n ? to : from; // a first core loop that establishes nothing: the plan is wrong
  if (next !== from) s.count = { ADVANCED: 0, STALLED: 0, REGRESSION: 0 };
  s.level = next;
}
function settle(s) { // the outcome of a review, once every NOT_MET is reproduced or dismissed
  const j = s.entry.judged;
  if (!j || j.outcome || Object.values(j.alleged).some((x) => x.status === undefined)) return;
  const dismissed = (id) => j.alleged[id] && j.alleged[id].status === 'no';
  const est = j.scope.filter((id) => j.met.includes(id) || dismissed(id)); // only a reproduced violation blocks; missing evidence stays open
  const regress = j.scope.filter((id) => s.est.includes(id) && j.alleged[id] && j.alleged[id].reproduced);
  const fresh = est.filter((id) => !s.est.includes(id)), failed = j.scope.filter((id) => !est.includes(id));
  j.established = est;
  j.outcome = regress.length ? 'REGRESSION' : !failed.length ? 'PASS' : fresh.length ? 'ADVANCED' : 'STALLED';
  s.failed = [...new Set([...s.failed, ...Object.keys(j.alleged).filter((id) => j.alleged[id].reproduced)])];
  if (j.kind === 'gate') s.est = s.est.filter((id) => !(j.alleged[id] && j.alleged[id].status !== 'no')); // a gate certifies BASE itself: what fails or lacks evidence there is not established
  if (['PASS', 'ADVANCED'].includes(j.outcome)) {
    s.est = [...new Set([...s.est, ...est])]; s.base = j.sha; // BASE moves only on PASS or ADVANCED
  } else { // the candidate never becomes BASE: save it, return to BASE
    fs.mkdirSync(TMP, { recursive: true });
    const f = path.join(TMP, `rejected-${s.history.length + 1}-${j.sha.slice(0, 7)}.diff`);
    fs.writeFileSync(f, git(['diff', s.base, j.sha]).out); git(['reset', '-q', '--hard', s.base]); j.saved = rel(f);
  }
  const fromLevel = s.level; ladder(s, j); j.from = fromLevel; j.to = s.level;
  if (j.kind === 'gate' && j.outcome === 'PASS') {
    if (j.stage === 'CORE') { s.stage = 'NON-CORE'; s.hard = true; } else s.gateSha = j.sha;
  }
  s.targets = j.outcome === 'PASS' ? openInStage(s) : failed;
  s.history.push(j);
}
function blocked(s, why) { s.level = 'replan'; s.blocked = why; }

// ── Rendering ────────────────────────────────────────────────────────────────────────────
function counts(s) {
  const C = plan().crit.filter((c) => !c.user), k = (t) => C.filter((c) => c.tag === t), e = (arr) => arr.filter((c) => s.est.includes(c.id)).length;
  return `CORE ${e(k('CORE'))}/${k('CORE').length} · NON-CORE ${e(k('NON-CORE'))}/${k('NON-CORE').length}`;
}
const levelLine = (s) => `level ${s.level} (at this level: ADVANCED ${s.count.ADVANCED}, STALLED ${s.count.STALLED}, REGRESSION ${s.count.REGRESSION})`;
const nextLines = (s) => FLOW[s.state].next.map((t) => { const x = needs(s, t); return `- ${t}: ${x.length ? 'needs ' + x.join('; ') : 'ready'}`; });
function board(s) {
  const P = plan();
  return [`# cheapGPT board (rendered by cheapgpt.mjs; do not edit)`, '',
    `## Task`, `${s.route} — ${s.reason} | cg/${s.slug} | state ${s.state} | stage ${s.stage} | ${levelLine(s)} | plan ${s.frozen ? s.frozen.slice(0, 12) + (s.hard ? ' (frozen)' : ' (provisional)') : 'not frozen'}`, '',
    `## BASE`, `${(s.base || '').slice(0, 7)} | ${counts(s)}`, '',
    `## Criteria`, ...P.crit.map((c) => `- ${c.id} ${c.tag}: ${c.user ? 'the user judges' : s.est.includes(c.id) ? 'established' : 'open'}`), '',
    `## Reviews`, ...s.history.map((h) => `- ${h.t.slice(11, 19)} ${h.kind}${h.kind === 'gate' ? ' ' + h.stage : ''} @${(h.sha || '').slice(0, 7)} → ${h.outcome} (${h.established.length}/${h.scope.length}); level ${h.from} → ${h.to}${h.saved ? '; candidate saved in ' + h.saved : ''}`), '',
    `## Step backs`, ...s.stepbacks.map((x) => `- ${x.size}${x.targets ? ' [' + x.targets.join(',') + ']' : ''}: ${x.text.slice(0, 200)}`), '',
    `## Open`, ...(s.blocked ? [`- blocked: ${s.blocked}`] : []), ...(s.targets.length ? [`- targets: ${s.targets.join(', ')}`] : []), ...(s.entry.prune ? [`- prune: ${s.entry.prune.text}`] : []), '',
    `## Vetoes`, ...s.vetoes.map((v) => '- ' + v), '', `## Backlog`, ...s.backlog.map((v) => '- ' + v), '', `## Notes`, ...s.notes.map((v) => '- ' + v), '',
    `## Next`, ...nextLines(s), ''].join('\n');
}
function report(s, final) {
  const P = plan(), j = s.history[s.history.length - 1], open = P.crit.filter((c) => !c.user && !s.est.includes(c.id)).map((c) => c.id);
  const ready = FLOW[s.state].next.find((t) => !needs(s, t).length);
  const out = [`Last: ${j ? `${j.outcome} (${j.kind}${j.kind === 'gate' ? ' ' + j.stage : ''}) → level ${j.to}` : 'no review yet'} — ${s.state}/${s.stage} — ${counts(s)} — open: ${open.join(', ') || 'none'} — next: ${FLOW[s.state].terminal ? 'end' : ready || needs(s, FLOW[s.state].next[0]).join('; ')}`];
  if (j) {
    out.push('', '| criterion | tag | result | what is missing |', '|---|---|---|---|');
    for (const c of P.crit.filter((x) => !x.user)) { const a = j.alleged[c.id]; out.push(`| ${c.id} | ${c.tag} | ${s.est.includes(c.id) ? 'established' : a && a.status === 'yes' ? 'NOT_MET (reproduced)' : a && a.status === 'missing' ? 'open (evidence missing)' : a ? 'NOT_MET (unconfirmed)' : 'open'} | ${s.est.includes(c.id) ? '' : a ? (a.evidence || '').slice(0, 120) : 'not built or not in scope yet'} |`); }
    const blocks = Object.entries(j.alleged).filter(([, x]) => x.status !== 'no').map(([id, x]) => id + (x.status === 'missing' ? ' (evidence missing)' : '')), notBlock = Object.entries(j.alleged).filter(([, x]) => x.status === 'no').map(([id]) => id + ' (unconfirmed)');
    out.push('', 'Blocks: ' + (blocks.join(', ') || 'nothing'), 'Does not block: ' + ([...notBlock, ...s.backlog.map((b) => 'backlog: ' + b)].join('; ') || 'nothing'));
  }
  if (final) {
    const user = P.crit.filter((c) => c.user);
    out.push('', `Delivered: cg/${s.slug} at ${head().slice(0, 7)} (gated ${(s.gateSha || '').slice(0, 7)}).`);
    if (user.length) out.push('Yours to judge:', ...user.map((c) => `- ${c.id} ${c.property} — ${(c.raw.split('judge:')[1] || '').replace(/^\s*user\s*[—-]?\s*/i, '')}`));
    if (s.vetoes.length) out.push('Vetoes: ' + s.vetoes.join('; '));
  }
  return out.join('\n');
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────
const freshEntry = () => ({ t: now(), runs: [], judged: null, prevent: null, replan: null, approved: null, merged: null, calls: [], finalReport: false, answer: null });
const [cmd, ...a] = process.argv.slice(2);
const flag = (f) => { const i = a.indexOf(f); if (i < 0) return false; a.splice(i, 1); return true; };
const opt = (f) => { const i = a.indexOf(f); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
const text = (min, what) => { const t = a.join(' ').trim(); if (t.length < min) die(`${what} (${min}+ characters)`); return t; };
const knownIds = (ids) => { const k = plan().crit.map((c) => c.id); for (const t of ids) if (!k.includes(t)) die('unknown criterion ' + t); return ids; };

const C = {
  init() {
    const [route, slug, ...why] = a;
    if (!['FOCUSED', 'FULL'].includes(route) || !slug) die('init <FOCUSED|FULL> <slug> "<reason>" (DIRECT uses no tool)');
    if (fs.existsSync(F.state)) die(`a task exists: ${CMD} status`);
    fs.mkdirSync(DIR, { recursive: true });
    const tracked = () => git(['ls-files']).out.split('\n').filter((f) => f && !METHOD_PATHS.some((m) => f === m || f.startsWith(m)));
    const existing = !git(['rev-parse', '--verify', 'HEAD']).code && tracked().length > 0;
    if (!fs.existsSync(path.join(DIR, 'git')) && !gitUsable(slug)) {
      const history = !git(['rev-parse', '--verify', 'HEAD']).code, bare = path.join(DIR, 'git');
      const r = history ? git(['clone', '--bare', '--no-hardlinks', '-q', ROOT, bare], ROOT) : git(['init', '--bare', '-b', 'main', bare], ROOT); if (r.code) die(r.out);
      if (history) git(['reset', '-q']);
      console.log(`.git refuses the writes the method makes here: the repository lives in cheapgpt/git${history ? ', with its history' : ''} (run git through ${CMD} git <args>)`);
    }
    const ex = path.resolve(ROOT, git(['rev-parse', '--git-dir']).out.trim(), 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true });
    const have = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n') : [];
    fs.appendFileSync(ex, ['cheapgpt/', 'temporary/'].filter((w) => !have.includes(w)).map((w) => w + '\n').join(''));
    if (git(['rev-parse', '--verify', 'HEAD']).code) { const c = git(['commit', '--allow-empty', '-m', 'cheapGPT baseline']); if (c.code) die(c.out); }
    const co = git(['checkout', '-q', '-B', 'cg/' + slug]); if (co.code) die(co.out);
    const s = { version: VERSION, route, slug, reason: why.join(' '), state: existing ? 'ADOPT' : 'PREFLIGHT', adopted: existing, stage: 'CORE', entry: freshEntry(), preflight: {}, adopt: null, planReview: null, frozen: null, frozenT: null, frozenSet: null, hard: false, est: [], failed: [], targets: [], level: 'tiny', count: { ADVANCED: 0, STALLED: 0, REGRESSION: 0 }, coreLoops: 0, blocked: null, base: head(), gateSha: null, stepbacks: [], history: [], vetoes: [], backlog: [], notes: [], calls: {}, runs: [], snap: null };
    save(s, { ev: 'init', route, slug, existing }); console.log(`CHEAPGPT: ${route} — ${s.reason}`); C.status();
  },
  status() {
    const s = load(), T = FLOW[s.state];
    console.log(`STATE ${s.state} · stage ${s.stage} · ${counts(s)} · ${levelLine(s)} · BASE ${(s.base || '').slice(0, 7)}\n\nCARD\n${s.state === 'LOOP' ? LOOP_CARD[s.level] : T.card}`);
    if (T.terminal) return;
    if (s.state === 'LOOP') console.log('\n' + STEP_BACK + (s.level === 'tiny' ? '\n\n' + MERGE : ''));
    if (['LOOP', 'GATE'].includes(s.state)) console.log('\n' + REVIEW_FORMAT);
    if (s.blocked) console.log(`\nBLOCKED (${s.blocked}): re-plan with the user`);
    if (s.state === 'LOOP') console.log('\nTARGETS\n' + (plan().crit.filter((c) => targets(s).includes(c.id)).map((c) => c.raw).join('\n') || 'none yet: name them in the step back (--targets)'));
    const j = s.entry.judged; if (j && !j.outcome) { const ids = Object.keys(j.alleged).filter((id) => j.alleged[id].status === undefined); if (ids.length) console.log('\nREPRODUCE before the outcome counts: ' + ids.map((id) => `reproduce ${id} yes|missing|no "<command and output>"`).join(' ; ')); }
    console.log('\nNEXT\n' + nextLines(s).join('\n'));
  },
  advance() {
    const s = load(), to = a[0]; if (!FLOW[to]) die('unknown state ' + to);
    const x = needs(s, to); if (x.length) die(`${s.state} → ${to} needs:\n- ` + x.join('\n- '));
    if (s.state === 'PLAN') s.targets = openInStage(s);
    if (s.state === 'ACCEPT' && to === 'LOOP') { s.level = 'replan'; s.notes.push("the user's feedback at ACCEPT: " + s.entry.answer); }
    s.state = to; s.entry = freshEntry(); save(s, { ev: 'advance', to }); C.status();
  },
  adopt() { const s = load(); if (s.state !== 'ADOPT') die('adopt belongs to ADOPT'); s.adopt = text(40, 'what exists, what works on the baseline run, which checks are protected'); save(s, { ev: 'adopt', text: s.adopt }); console.log('adoption recorded'); },
  preflight() {
    const s = load(), [p, res, ...ev] = a;
    if (!['P1', 'P2'].includes(p) || !['ok', 'requested', 'fail'].includes(res) || (p === 'P1' && res === 'requested')) die('preflight P1 ok|fail "<evidence>" | preflight P2 ok|requested|fail "<evidence>" (P3 is recorded by isolation)');
    if (ev.join(' ').trim().length < 10) die('the evidence: where the harness record shows it');
    s.preflight[p] = res;
    save(s, { ev: 'preflight', p, res, evidence: ev.join(' ') }); console.log(`${p} ${res}${res === 'requested' ? ' (report it to the user as requested, not confirmed)' : res === 'fail' ? ' (that role stops: fix the spawn and record again, or blocked)' : ''}`);
  },
  isolation() { const s = load(); if (!s.snap) die('no open reviewer call'); const ok = sameTree(s.snap, snapshot()); console.log(ok ? 'repository unchanged since the reviewer call' : 'repository CHANGED since the reviewer call'); if (s.state === 'PREFLIGHT') s.preflight.P3 = ok ? 'ok' : 'fail'; if (ok) s.snap = null; save(s, { ev: 'isolation', ok }); process.exit(ok ? 0 : 1); },
  freeze() {
    const s = load(), user = opt('--user'), P = plan(); if (P.errors.length) die('plan:\n- ' + P.errors.join('\n- '));
    if (!['PLAN', 'LOOP'].includes(s.state)) die('freeze belongs to PLAN, or to a loop');
    if (s.hard && !(s.state === 'LOOP' && s.level === 'replan' && s.entry.replan)) die('the acceptance list is frozen hard: only a re-plan with the user changes it');
    if (s.frozenSet && P.hash !== s.frozen) {
      const removed = s.frozenSet.ids.filter((id) => !P.crit.some((c) => c.id === id)), goals = P.goals.map((g) => g.raw).join('\n') !== s.frozenSet.goals;
      const why = [...(s.hard ? ['frozen hard'] : []), ...(removed.length ? [`removed: ${removed.join(', ')}`] : []), ...(goals ? ['the goals changed'] : [])];
      if (why.length && (!user || user.trim().length < 3)) die(`this change needs the user (${why.join('; ')}): freeze --user "<their words>"`);
    }
    s.frozen = P.hash; s.frozenT = now(); s.frozenSet = { ids: P.crit.map((c) => c.id), goals: P.goals.map((g) => g.raw).join('\n') };
    s.est = s.est.filter((id) => P.crit.some((c) => c.id === id)); if (s.state === 'LOOP') s.targets = s.targets.filter((id) => P.crit.some((c) => c.id === id));
    save(s, { ev: 'freeze', hash: P.hash, hard: s.hard, user }); console.log(`frozen ${P.hash.slice(0, 12)} (${s.hard ? 'hard' : 'provisional until the core gate passes'})`);
  },
  planreview() {
    const s = load(), id = a[0]; if (s.state !== 'PLAN' || !s.adopted) die('planreview belongs to PLAN on an adopted project');
    if (s.planReview) die('the plan is reviewed once; its FIX is applied once');
    if (!s.calls[id] || s.calls[id].role !== 'reviewer') die(`${id} is not a reviewer call`);
    if (!s.snap || !sameTree(s.snap, snapshot())) { s.snap = null; save(s, { ev: 'review-void', id }); die('the repository changed during the review (or no snapshot): void; redispatch it once'); }
    const out = path.join(DIR, 'runs', id, 'out.md'); if (!fs.existsSync(out)) die(`${rel(out)} not found`);
    const m = fs.readFileSync(out, 'utf8').trim().match(/^(PASS|FIX)\b/); if (!m) die('the reply opens with PASS or FIX');
    s.snap = null; s.planReview = { verdict: m[1], t: now(), id }; save(s, { ev: 'planreview', verdict: m[1] }); console.log(`plan review: ${m[1]}${m[1] === 'FIX' ? ' — the planner applies it once, then freeze' : ''}`);
  },
  stepback() {
    const s = load(), size = a.shift(), tg = (opt('--targets') || '').split(',').filter(Boolean);
    if (s.state !== 'LOOP') die('step backs belong to a loop');
    if (size !== s.level) die(`level ${s.level}: stepback ${s.level}`);
    if (size === 'replan' && !s.entry.replan) die('a re-plan starts with the user\'s words: replan "<their comment>"');
    if (s.entry.prevent) die('one step back per loop');
    if (size !== 'replan' && s.frozen && plan().hash !== s.frozen) die('the plan changed since the freeze: freeze it first');
    if (!tg.length && size === 'replan' && (s.entry.replan.targets || s.targets).length) tg.push(...(s.entry.replan.targets || s.targets));
    if (!tg.length) die('--targets <IDs>: the criteria this loop closes'); knownIds(tg);
    const off = tg.filter((id) => !stageScope(s).includes(id) && !s.targets.includes(id)); if (off.length) die(`not in this stage's scope: ${off.join(', ')}`);
    const t = text(size === 'tiny' ? 40 : 80, 'a step back answers its questions:\n' + STEP_BACK);
    s.entry.prevent = { t: now(), targets: tg }; s.stepbacks.push({ size, targets: tg, text: t, t: now() });
    save(s, { ev: 'stepback', size, targets: tg, text: t }); console.log(`${size} step back recorded (PREVENT)`);
  },
  replan() {
    const s = load(), tg = (opt('--targets') || '').split(',').filter(Boolean); knownIds(tg);
    if (s.state !== 'LOOP' || s.level !== 'replan') die('replan belongs to a loop at level replan');
    if (!tg.length && !s.targets.length) die('--targets <IDs>: what this re-plan closes');
    const t = text(3, "the user's comment"); s.entry.replan = { t: now(), text: t, targets: tg.length ? tg : null }; s.blocked = null;
    s.stepbacks.push({ size: 'replan', targets: s.entry.replan.targets, text: "user: " + t, t: now() }); save(s, { ev: 'replan', text: t }); console.log('re-plan opened with the user\'s words');
  },
  approve() {
    const s = load(); if (s.state !== 'LOOP' || s.level !== 'replan' || !s.entry.replan) die('approve follows replan, in a re-plan loop');
    const P = plan(); if (P.errors.length || s.frozen !== P.hash) die('freeze the new plan first (show it to the user, then approve)');
    const tips = Object.fromEntries(s.entry.calls.filter((c) => s.calls[c].role === 'breaker').map((c) => [c, git(['rev-parse', 'cg/' + c]).out.trim()]));
    if (!s.entry.prevent) die('record the loop-breaker\'s step back first: stepback replan --targets <IDs> "..."');
    s.entry.approved = { t: now(), text: text(3, "the user's words"), tips }; s.count = { ADVANCED: 0, STALLED: 0, REGRESSION: 0 };
    save(s, { ev: 'approve', text: s.entry.approved.text }); console.log('the user approved the plan: the loop-breaker builds');
  },
  call() {
    const s = load(), role = a[0], roles = ['dynamic', 'mechanical', 'breaker', 'reviewer'];
    if (!roles.includes(role)) die('call dynamic|mechanical|breaker|reviewer');
    const e = s.entry; let commit;
    if (role === 'reviewer') {
      const d = dirty(); if (d.length) die('reviewers review a commit: commit the candidate first (uncommitted: ' + d.slice(0, 3).join(', ') + ')');
      if (s.state === 'LOOP') {
        loopGuard(s, 'review');
        if (!e.merged) die('merge the builders\' work first');
        if (!e.runs.some((r) => r.kind === 'run' && r.sha === head() && r.t > e.merged.t)) die('run the affected path on this commit first (run -- <command>)');
      }
      if (s.state === 'GATE') {
        if (s.stage === 'NON-CORE' && !e.prune) die('the release gate records the prune first: prune "<what was removed>" | prune none');
        if (!e.runs.some((r) => r.kind === 'e2e' && r.code === 0 && r.sha === head() && (!e.prune || r.t > e.prune.t))) die('run the product end to end on this commit first, passing (run --e2e -- <command>)');
      }
      if (!['PREFLIGHT', 'PLAN', 'LOOP', 'GATE'].includes(s.state)) die('no review belongs to ' + s.state);
      commit = head(); if (!s.snap) s.snap = snapshot();
    } else {
      if (s.state !== 'LOOP') die('builders work inside a loop');
      if (role === 'breaker' ? s.level === 'tiny' : s.level !== 'tiny') die(role === 'breaker' ? 'at level tiny the dynamic and mechanical builders build' : `at level ${s.level} the loop-breaker builds alone (call breaker)`);
      loopGuard(s, 'call');
      if (e.merged) die('this loop is merged: review it');
      if (e.calls.some((c) => s.calls[c].role === role)) die(`one ${role} per loop`);
      commit = s.base;
    }
    const id = crypto.randomBytes(4).toString('hex'), run = path.join(DIR, 'runs', id), wt = path.join(DIR, 'wt', id); fs.mkdirSync(run, { recursive: true });
    const r = git(['worktree', 'add', '-q', '-b', 'cg/' + id, wt, commit]); if (r.code) die(r.out);
    s.calls[id] = { role, commit, t: now(), worktree: wt }; e.calls.push(id); save(s, { ev: 'call', id, role, commit });
    console.log(`call ${id} (${role}) at ${commit.slice(0, 7)}\npacket: ${rel(run)}/packet.md\nreturn: ${rel(run)}/out.md (the reply, verbatim)\nworktree: ${rel(wt)}${role === 'reviewer' ? '' : ' (the child commits its work there, on branch cg/' + id + ')'}`);
  },
  merge() {
    const s = load(), ids = (a[0] || '').split(',').filter(Boolean), e = s.entry;
    if (s.state !== 'LOOP') die('merge belongs to a loop'); loopGuard(s, 'merge');
    if (e.merged) die('this loop is merged'); if (!ids.length) die('merge <id>[,<id>]');
    for (const id of ids) if (!e.calls.includes(id) || s.calls[id].role === 'reviewer') die(`${id} is not a builder or loop-breaker call of this loop`);
    if (head() !== s.base) die(`the product is not at BASE ${s.base.slice(0, 7)} (HEAD ${head().slice(0, 7)})`);
    if (dirty().length) die('uncommitted product changes: the product must be at BASE');
    const files = {};
    for (const id of ids) {
      const br = 'cg/' + id, n = +git(['rev-list', '--count', `${s.base}..${br}`]).out.trim();
      if (!n) die(`${id} committed nothing on ${br} (an idle builder: record an empty allocation instead)`);
      if (s.level === 'replan' && (e.approved.tips[id] || s.base) !== s.base) die(`${id} has commits from before the user approved the plan: rebuild after approve`);
      files[id] = git(['diff', '--name-only', s.base, br]).out.split('\n').filter(Boolean);
    }
    if (ids.length === 2) { const both = files[ids[0]].filter((f) => files[ids[1]].includes(f)); if (both.length) die(`both builders changed ${both.join(', ')}: re-allocate disjoint paths`); }
    for (const id of ids) { const r = git(['merge', '-q', '--no-ff', '-m', `cheapGPT: merge ${s.calls[id].role} ${id}`, 'cg/' + id]); if (r.code) { git(['merge', '--abort']); git(['reset', '-q', '--hard', s.base]); die('merge failed: ' + r.out.slice(0, 300)); } }
    e.merged = { t: now(), sha: head(), ids }; save(s, { ev: 'merge', ids, sha: e.merged.sha }); console.log(`merged at ${head().slice(0, 7)}; commit only the seam, then run the affected path`);
  },
  run() {
    const s = load(), kind = flag('--e2e') ? 'e2e' : flag('--before') ? 'before' : 'run', judgment = flag('--judgment');
    if (!['ADOPT', 'LOOP', 'GATE'].includes(s.state)) die('runs belong to ADOPT, a loop or a gate');
    if (kind === 'e2e' && s.state !== 'GATE') die('--e2e belongs to a gate');
    if (kind === 'before' && s.state !== 'LOOP') die('--before belongs to a loop');
    if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die('run [--e2e|--before [--judgment]] -- <command>');
    let dir = ROOT, wt = null;
    if (kind === 'before') { wt = path.join(DIR, 'wt', 'base-' + crypto.randomBytes(3).toString('hex')); const r = git(['worktree', 'add', '-q', '--detach', wt, s.base]); if (r.code) die(r.out); dir = wt; }
    const t0 = Date.now(), r = sh(command, [], { cwd: dir, shell: true, timeout: 3 * 3600e3 });
    const rec = { kind, command, code: r.code, sha: kind === 'before' ? s.base : head(), secs: Math.round((Date.now() - t0) / 100) / 10, t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
    if (wt) { git(['worktree', 'remove', '--force', wt]); fs.rmSync(wt, { recursive: true, force: true }); }
    s.entry.runs.push(rec); s.runs.push(rec); save(s, { ev: 'run', ...rec });
    process.stdout.write(r.out); console.log(`\n[cheapgpt] ${kind} exit ${r.code} on ${rec.sha.slice(0, 7)} in ${rec.secs}s`);
  },
  review() {
    const s = load(), id = a[0], e = s.entry;
    if (!['LOOP', 'GATE'].includes(s.state)) die('review belongs to a loop or a gate');
    if (!s.calls[id] || s.calls[id].role !== 'reviewer' || !e.calls.includes(id)) die(`${id} is not a reviewer call of this ${s.state.toLowerCase()}`);
    if (e.judged) die(e.judged.outcome ? 'this one is reviewed; follow the outcome' : 'reproduce the open NOT_MET first');
    if (!s.snap) die('no snapshot: call reviewer first');
    const before = s.snap, after = snapshot(); s.snap = null;
    if (!sameTree(before, after)) { save(s, { ev: 'review-void', id }); die('the repository changed during the review: void; redispatch it once with the same packet'); }
    const scope = s.state === 'GATE' ? gateScope(s) : targets(s).filter((t) => !plan().crit.find((c) => c.id === t).user);
    if (!scope.length) die('nothing a reviewer can decide in scope');
    const res = parseOut(path.join(DIR, 'runs', id, 'out.md'), scope);
    if (res.incomplete.length) {
      if (s.calls[id].redispatched) { blocked(s, `reviewer ${id} incomplete after its re-dispatch`); save(s, { ev: 'review-incomplete', id, blocked: true }); die(`incomplete after its re-dispatch: blocked → re-plan with the user\n- ${res.incomplete.join('\n- ')}`); }
      save(s, { ev: 'review-incomplete', id }); die(`incomplete:\n- ${res.incomplete.join('\n- ')}\nredispatch ${id} once with the same packet, then review again`);
    }
    const alleged = {}; for (const c of scope) if (res.v[c] === 'NOT_MET') alleged[c] = {};
    const kind = s.state === 'GATE' ? 'gate' : 'loop';
    e.judged = { kind, stage: s.stage, sha: before.head, scope, met: scope.filter((c) => res.v[c] === 'MET'), alleged, t: now(), outcome: null, established: [], firstCore: kind === 'loop' && s.stage === 'CORE' && s.coreLoops === 0 && !s.history.some((h) => h.kind === 'loop') };
    if (kind === 'loop' && s.stage === 'CORE') s.coreLoops++;
    settle(s); save(s, { ev: 'review', kind, met: e.judged.met, alleged: Object.keys(alleged), outcome: e.judged.outcome }); C.status();
  },
  reproduce() {
    const s = load(), [id, st, ...ev] = a, j = s.entry.judged;
    if (!j || !j.alleged[id] || !['yes', 'missing', 'no'].includes(st) || j.alleged[id].status !== undefined) die('reproduce <ID> yes|missing|no "<command and output>" (once per open NOT_MET): yes, a run shows the violation; missing, the deciding run could not be made, so the criterion stays open without counting as a defect; no, the run shows the criterion holds');
    if (ev.join(' ').trim().length < 10) die('the command you ran and its output (missing: the run that could not be made, and why)');
    j.alleged[id].status = st; j.alleged[id].reproduced = st === 'yes'; j.alleged[id].evidence = ev.join(' '); settle(s); save(s, { ev: 'reproduce', id, status: st, evidence: ev.join(' ') }); C.status();
  },
  redispatch() {
    const s = load(), id = a[0]; if (!s.calls[id]) die('unknown call'); if (s.calls[id].redispatched) die('a call is re-dispatched once; a second failure is blocked → re-plan');
    s.calls[id].redispatched = true; const wt = s.calls[id].worktree; git(['reset', '-q', '--hard', s.calls[id].commit], wt); git(['clean', '-qfdx'], wt);
    if (s.calls[id].role === 'reviewer') s.snap = snapshot(); save(s, { ev: 'redispatch', id }); console.log(`re-dispatch ${id} with the same packet; its reply replaces out.md`);
  },
  blocked() { const s = load(); if (!['LOOP', 'GATE', 'PREFLIGHT', 'PLAN'].includes(s.state)) die('nothing to block here'); const t = text(10, 'what blocks the work'); blocked(s, t); save(s, { ev: 'blocked', text: t }); console.log('blocked: the next loop is a re-plan with the user' + (s.state === 'LOOP' ? '' : ' (the user decides: replan once a loop opens, or stop)')); },
  prune() { const s = load(); if (s.state !== 'GATE' || s.stage !== 'NON-CORE') die('prune belongs to the release gate'); s.entry.prune = { t: now(), text: text(4, 'what was removed, or none') }; save(s, { ev: 'prune', text: s.entry.prune.text }); console.log('prune recorded; commit, then run --e2e on that commit'); },
  answer() { const s = load(); if (s.state !== 'ACCEPT') die('answer belongs to ACCEPT (a re-plan records replan / approve)'); s.entry.answer = text(3, "the user's words"); save(s, { ev: 'answer', text: s.entry.answer }); console.log('answer recorded'); },
  report() { const s = load(), final = flag('--final'); if (final) { if (s.state !== 'ACCEPT') die('--final belongs to ACCEPT'); s.entry.finalReport = true; save(s, { ev: 'report', final }); } console.log(report(s, final)); },
  veto() { const s = load(); s.vetoes.push(text(10, 'a veto names what failed and its replacement')); save(s, { ev: 'veto', text: a.join(' ') }); console.log('veto recorded'); },
  backlog() { const s = load(); s.backlog.push(text(5, 'a backlog item')); save(s, { ev: 'backlog', text: a.join(' ') }); console.log('backlog recorded'); },
  note() { const s = load(); s.notes.push(text(5, 'a note')); save(s, { ev: 'note', text: a.join(' ') }); console.log('note recorded'); },
  clean() {
    const s = load(); if (!FLOW[s.state].terminal) die('clean only after DONE or STOPPED');
    for (const id of Object.keys(s.calls)) { git(['worktree', 'remove', '--force', s.calls[id].worktree]); git(['branch', '-q', '-D', 'cg/' + id]); }
    git(['worktree', 'prune']);
    for (const d of fs.readdirSync(DIR)) if (!['git', 'reports'].includes(d)) fs.rmSync(path.join(DIR, d), { recursive: true, force: true });
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log('task files removed (cheapgpt/git and cheapgpt/reports kept)');
  },
  git() { const r = git(a); process.stdout.write(r.out); process.exit(r.code); },
  check() { // flow validator: every state has a card, known targets, is reachable and can end
    const errs = [];
    for (const [k, v] of Object.entries(FLOW)) { if (!v.card && k !== 'LOOP') errs.push(k + ': no card'); for (const t of v.next) if (!FLOW[t]) errs.push(`${k} → ${t}: unknown`); }
    for (const l of LEVELS) if (!LOOP_CARD[l]) errs.push('LOOP: no card for level ' + l);
    for (const k of Object.keys(FLOW)) { const seen = new Set([k]), q = [k]; let ok = false; while (q.length) { const x = q.shift(); if (FLOW[x].terminal) { ok = true; break; } for (const t of FLOW[x].next) if (!seen.has(t)) { seen.add(t); q.push(t); } } if (!ok) errs.push(k + ': cannot end'); }
    const reach = new Set(['ADOPT', 'PREFLIGHT']), q = ['ADOPT', 'PREFLIGHT']; while (q.length) for (const t of FLOW[q.shift()].next) if (!reach.has(t)) { reach.add(t); q.push(t); }
    for (const k of Object.keys(FLOW)) if (!reach.has(k)) errs.push(k + ': unreachable');
    console.log(errs.length ? 'FLOW INVALID\n- ' + errs.join('\n- ') : `FLOW OK: ${Object.keys(FLOW).length} states, each reachable and able to end; loop levels ${LEVELS.join(', ')}`);
    process.exit(errs.length ? 1 : 0);
  },
  flow() { console.log(Object.entries(FLOW).map(([k, v]) => `${k} → ${v.next.join(', ') || '(end)'}`).join('\n') + `\n\nLADDER (outcomes counted per level since the last PASS or level change; PASS → tiny)\ntiny:   ADVANCED stays (3rd → full) · STALLED stays (2nd → full; the stage's first core loop → replan) · REGRESSION stays (2nd → full)\nfull:   ADVANCED → tiny · STALLED stays (2nd → replan) · REGRESSION stays (2nd → replan)\nreplan: ADVANCED → tiny · STALLED → replan · REGRESSION → replan\nBLOCKED → replan`); },
  version() { console.log(VERSION); },
};
if (!C[cmd]) { console.log('cheapgpt.mjs ' + VERSION + '\ncommands: ' + Object.keys(C).join(' ')); process.exit(cmd ? 2 : 0); }
C[cmd]();
