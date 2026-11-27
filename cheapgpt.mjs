#!/usr/bin/env node
// cheapGPT engine: runs the flow in flow.json, binds the cards in cards/, enforces what can be computed.
// Judgment stays with the agent (the profile and the cards); the user's decisions stay with the user.
// Node standard library only. Installed as .cheapgpt/cheapgpt.mjs with .cheapgpt/flow.json and .cheapgpt/cards/;
// run from the repository root: node .cheapgpt/cheapgpt.mjs <command> ...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.10.3';
const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(ROOT, 'cheapgpt');
const TMP = path.join(ROOT, 'temporary');
const F = { state: path.join(DIR, 'state.json'), log: path.join(DIR, 'log.jsonl'), board: path.join(DIR, 'board.md'), plan: path.join(DIR, 'plan.md') };
const METHOD_PATHS = ['.cheapgpt/', '.codex/', '.claude/', 'AGENTS.md', 'CLAUDE.md']; // the installed method, never part of the product
const CMD = 'node ' + (path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/') || 'cheapgpt.mjs');
const TAGS = ['CORE', 'NON-CORE'];
const ZERO = () => ({ ADVANCED: 0, STALLED: 0, REGRESSION: 0 });

const now = () => new Date().toISOString();
const die = (msg) => { console.error('REFUSED: ' + msg); process.exit(2); };
const NEXT_HINT = `${CMD} status shows the state, its card and what each exit needs`;

// ── Flow and cards: data, read at start ──────────────────────────────────────────────────
function readFlow() {
  const p = path.join(HERE, 'flow.json');
  if (!fs.existsSync(p)) die(`flow.json is missing next to the engine (${p}): reinstall with install.mjs update`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const FLOWDATA = readFlow();
const FLOW = FLOWDATA.states, LADDER = FLOWDATA.ladder;
function readCards() { // cards/<id>.md: front matter (card, state, level, role, loads), then the body
  const dir = path.join(HERE, 'cards'), cards = {};
  if (!fs.existsSync(dir)) return cards;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'), m = t.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { cards[f] = { file: f, bad: 'no front matter' }; continue; }
    const fm = Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s*/)).filter((x) => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
    cards[fm.card || f] = { file: f, ...fm, states: (fm.state || '').split(/,\s*/).filter(Boolean), body: m[2].trim().replaceAll('{{cmd}}', CMD) };
  }
  return cards;
}
const CARDS = readCards();
const bound = (q) => FLOWDATA.cards.filter((b) => b.state === q.state && b.role === q.role && (!b.level || b.level === q.level) && (!b.route || b.route === q.route));
function cardText(q) {
  const out = [];
  for (const b of bound(q)) { const c = CARDS[b.card]; if (!c || !c.body) die(`card "${b.card}" (${b.state}${b.level ? '/' + b.level : ''}, ${b.role}) is missing from ${path.join(HERE, 'cards')}: reinstall with install.mjs update`); out.push(c.body); }
  return out.join('\n\n');
}

// ── State, log, git ────────────────────────────────────────────────────────────────────────
function load() {
  if (!fs.existsSync(F.state)) die(`no task here: ${CMD} init <FOCUSED|FULL> <slug> "<reason>" (DIRECT uses no tool)`);
  const s = JSON.parse(fs.readFileSync(F.state, 'utf8'));
  if ('stage' in s) { // a task started on 1.10.0 (a core and a non-core stage) continues on one features stage
    if (s.adopt) s.notes.push('adoption record (before 1.10.2): ' + s.adopt);
    for (const k of ['stage', 'hard', 'coreLoops', 'adopt']) delete s[k];
    s.blocks = []; s.entry.block = null;
  }
  if (s.version !== VERSION) { // saved by an earlier version mid-state: the prevent is owed from the next state entry
    const from = s.version; if (!(s.entry.prevent && s.entry.block)) s.entry.legacy = true;
    s.version = VERSION; save(s, { ev: 'migrate', from, to: VERSION });
  }
  return s;
}
function save(s, event) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F.state, JSON.stringify(s, null, 2));
  if (event) fs.appendFileSync(F.log, JSON.stringify({ t: now(), state: s.state, level: s.level, ...event }) + '\n');
  fs.writeFileSync(F.board, board(s));
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd || ROOT, maxBuffer: 1 << 26, shell: !!opts.shell, timeout: opts.timeout });
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
const diffSize = (from, to) => git(['diff', '--numstat', from, to]).out.split('\n').filter(Boolean).reduce((n, l) => n + (+l.split('\t')[0] || 0) + (+l.split('\t')[1] || 0), 0);
function gitProbe(slug) { // make the very writes the method needs, never a proxy: the exclude file, the task branch checked out, a cg/ worktree and a commit in it; '' when all work, else what refused
  const why = (what, r) => `${what}: ${r.out.trim().split('\n').pop() || 'refused'}`;
  let r;
  if (!fs.existsSync(path.join(ROOT, '.git')) && !gitDirArgs().length && (r = git(['init', '-b', 'main'])).code) return why('git init', r);
  if (git(['rev-parse', '--verify', 'HEAD']).code && (r = git(['commit', '--allow-empty', '-m', 'cheapGPT baseline'])).code) return why('the baseline commit', r);
  const gd = git(['rev-parse', '--git-dir']).out.trim(); if (!gd) return 'no repository found';
  try { const ex = path.resolve(ROOT, gd, 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, ''); } catch (e) { return 'info/exclude: ' + e.message; }
  if ((r = git(['checkout', '-q', '-B', 'cg/' + slug])).code) return why('the task branch', r);
  const tag = crypto.randomBytes(3).toString('hex'), br = 'cg/probe-' + tag, wt = path.join(DIR, 'wt', 'probe-' + tag);
  const w = git(['worktree', 'add', '-q', '-b', br, wt, 'HEAD']), c = w.code ? w : git(['commit', '-q', '--allow-empty', '-m', 'cheapGPT probe'], wt);
  git(['worktree', 'remove', '--force', wt]); git(['branch', '-q', '-D', br]); git(['worktree', 'prune']); fs.rmSync(wt, { recursive: true, force: true });
  return w.code ? why('a worktree', w) : c.code ? why('a commit in a worktree', c) : '';
}
const STORE = path.join(DIR, 'git'), storeLine = () => fs.existsSync(STORE) ? `git: cheapgpt/git (${CMD} git <args>)` : '';

// ── The plan: goals mapped to criteria, criteria with their deciding run and boundary ────
function section(text, name) {
  const start = text.search(new RegExp(`^## ${name}\\s*$`, 'm')); if (start < 0) return null;
  const body = text.slice(start).split('\n').slice(1), end = body.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? body : body.slice(0, end)).map((l) => l.trim()).filter((l) => l.startsWith('- '));
}
function plan() {
  if (!fs.existsSync(F.plan)) return { crit: [], goals: [], errors: ['cheapgpt/plan.md is missing (the plan card gives its format)'], hash: null };
  const text = fs.readFileSync(F.plan, 'utf8'), errors = [], crit = [], goals = [];
  const cl = section(text, 'Acceptance'), gl = section(text, 'Goals');
  if (!cl) errors.push('no "## Acceptance" section'); if (!gl) errors.push('no "## Goals" section');
  for (const raw of cl || []) {
    const parts = raw.slice(2).split(' | ').map((p) => p.trim()), [id, tag, property] = parts;
    const field = (k) => (parts.find((p) => p.startsWith(k + ':')) || '').slice(k.length + 1).trim();
    const c = { id, tag, property, run: field('run'), boundary: field('boundary'), user: /^user\b/i.test(field('judge')), raw };
    if (!id || !TAGS.includes(tag) || !property) { errors.push(`"${raw.slice(0, 50)}…" needs "<ID> | CORE|NON-CORE | <property>"`); continue; }
    if (!c.run) errors.push(`${id}: add "| run: <the real run that decides it>"`); if (!c.boundary) errors.push(`${id}: add "| boundary: <the closest input where a wrong result would still look right>"`);
    if (crit.some((x) => x.id === id)) errors.push(`${id}: duplicate ID`);
    crit.push(c);
  }
  for (const raw of gl || []) {
    const [gid, words, map] = raw.slice(2).split(' | ').map((p) => p.trim());
    if (!gid || !words || !map) { errors.push(`goal "${raw.slice(0, 50)}…" needs "<G#> | <the user's words> | <IDs> or Drop: <reason>"`); continue; }
    const drop = /^Drop:\s*\S/.test(map), ids = drop ? [] : map.split(/[,\s]+/).filter(Boolean);
    for (const id of ids) if (!crit.some((c) => c.id === id)) errors.push(`${gid}: maps to unknown criterion ${id}`);
    if (!drop && !ids.length) errors.push(`${gid}: map it to criteria or to "Drop: <reason>"`);
    goals.push({ gid, raw, ids, drop });
  }
  for (const c of crit) if (!goals.some((g) => g.ids.includes(c.id))) errors.push(`${c.id}: no goal traces to it (map it from a goal, or remove it)`);
  if (!crit.some((c) => c.tag === 'CORE' && !c.user)) errors.push('add a CORE criterion a reviewer can decide');
  return { crit, goals, errors, hash: sha256([...(gl || []), ...(cl || [])].join('\n')) };
}
const reviewable = () => plan().crit.filter((c) => !c.user).map((c) => c.id);
const openItems = (s) => reviewable().filter((id) => !s.est.includes(id));
const targets = (s) => (s.entry.prevent && s.entry.prevent.targets && s.entry.prevent.targets.length && s.entry.prevent.targets) || (s.entry.replan && s.entry.replan.targets) || s.targets;
const stepbackHint = (s) => `${CMD} stepback ${s.state === 'LOOP' ? s.level + ' --targets <IDs> ' : ''}"<the whole>" (the step-back card${s.state === 'LOOP' && s.level !== 'tiny' ? "; the loop-breaker's, recorded by you" : ''})`;
const reviewHint = (s) => s.state === 'LOOP' && s.route === 'FOCUSED' ? `your mini-review: cheapgpt/mini.md, then ${CMD} review mini (the mini-review card)` : `${CMD} call reviewer, then review <id>`;

// ── Guards: named functions; flow.json says which apply to which transition ───────────────
const GUARDS = {
  baselineRun: (s) => s.entry.runs.some((r) => r.kind === 'run') ? [] : [`the baseline real run on HEAD: ${CMD} run -- <command>`],
  prevented: (s) => s.entry.legacy ? [] : [...(s.entry.prevent ? [] : [`the step back: ${stepbackHint(s)}`]), ...(s.entry.block ? [] : [`the one-block: ${CMD} block "<the next action, whole>" (the one-block card)`])],
  planValid: () => plan().errors.map((x) => 'plan: ' + x),
  planFrozen: (s) => s.frozen === plan().hash ? [] : [`freeze the plan: ${CMD} freeze`],
  planReviewed: (s) => !s.adopted ? [] : !s.planReview ? [`the plan review: ${CMD} call reviewer, then planreview <id>`] : s.planReview.verdict === 'FIX' && !(s.frozenT > s.planReview.t) ? [`apply the FIX once, then ${CMD} freeze`] : [],
  planUnchanged: (s) => !s.frozen || plan().hash === s.frozen ? [] : [`the plan changed since the freeze: ${CMD} freeze (with --user "<their words>" where the change is theirs)`],
  loopReviewed: (s) => !s.entry.merged || s.blocked || (s.entry.judged && s.entry.judged.outcome) ? [] : [`this loop's review and its settled outcome: ${reviewHint(s)}; reproduce each NOT_MET`],
  allEstablished: (s) => openItems(s).length ? [`items still open: ${openItems(s).join(', ')}: another loop (${CMD} advance LOOP)`] : [],
  userStops: (s) => s.level === 'replan' && s.entry.replan ? [] : [`STOPPED only on the user's words at a re-plan: ${CMD} replan "<their words>"`],
  gateSettled: (s) => { const j = s.entry.judged; return s.blocked ? [] : !j || !j.outcome ? [`the gate's review and its settled outcome: ${CMD} call reviewer, review <id>, reproduce each NOT_MET`] : j.outcome === 'PASS' ? [`the release gate passed: ${CMD} advance ACCEPT`] : []; },
  gatePassed: (s) => { const j = s.entry.judged; return j && j.outcome === 'PASS' ? [] : j && j.outcome ? [`the gate did not pass: a loop on its failures (${CMD} advance LOOP)`] : [`the release gate's settled review: ${CMD} run --e2e, call reviewer, review <id>`]; },
  userAnswer: (s) => s.entry.answer ? [] : [`the user's reply: ${CMD} answer "<their words>"`],
  finalReport: (s) => s.entry.finalReport ? [] : [`the final report: ${CMD} report --final`],
  gatedHead: () => [], // checked with HEAD below (needs git)
};
function needs(s, to) {
  const st = FLOW[s.state];
  if (!st.next.includes(to)) return [`${s.state} cannot go to ${to}; it goes to ${st.next.join(', ') || 'nothing (the task is over)'}`];
  const n = [];
  for (const g of [...(st.exit || []), ...((st.to || {})[to] || [])]) n.push(...GUARDS[g](s, to));
  if ((st.to || {})[to] && st.to[to].includes('gatedHead') && head() !== s.gateSha) n.push(`HEAD ${head().slice(0, 7)} is not the gated commit ${(s.gateSha || 'none').slice(0, 7)}: deliver the gated commit (${CMD} git reset --hard ${(s.gateSha || '').slice(0, 7)}), or give the user's feedback a re-plan and gate again (${CMD} advance LOOP)`);
  return n;
}
function reviewReady(s) { // a loop's review judges its merged, committed candidate after a real run of it
  const e = s.entry; loopGuard(s, 'review');
  if (!e.merged) die(`merge the loop's work first: ${CMD} merge <id>[,<id>]`);
  const d = dirty(); if (d.length) die(`a review judges a commit; ${d.slice(0, 3).join(', ')} uncommitted: commit it first: git commit (${CMD} git commit when the repository lives in cheapgpt/git)`);
  if (!e.runs.some((r) => r.kind === 'run' && r.sha === head() && r.t > e.merged.t)) die(`run the affected path on this commit first: ${CMD} run -- <command>`);
}
function allowed(s, name) { // a command runs only in the states flow.json names for it, and a state's work only after its prevent
  const where = FLOWDATA.commands[name];
  if (where && !where.includes(s.state)) die(`${name} belongs to ${where.join(' or ')}; this task is in ${s.state}: ${NEXT_HINT}`);
  if ((FLOWDATA.prevent[s.state] || []).includes(name)) { const p = GUARDS.prevented(s); if (p.length) die(`PREVENT first: ${name} in ${s.state} waits for ${p.join('; ')}`); }
}
function loopGuard(s, what) { // the evidence a loop step owes before `what`
  const e = s.entry;
  const pu = GUARDS.planUnchanged(s); if (pu.length) die(pu[0]);
  if (s.level === 'replan' && !e.replan) die(`a re-plan starts with the user's words: ${CMD} replan "<their comment>"`);
  if (what !== 'merge') return;
  if (s.level === 'replan' && !e.approved) die(`the user approves the new plan before anything is built: ${CMD} approve "<their words>"`);
  const failed = targets(s).filter((id) => s.failed.includes(id));
  if (failed.length && !e.runs.some((r) => r.kind === 'before' && (r.code !== 0 || r.judgment))) die(`${failed.join(', ')} failed before: reproduce on BASE first: ${CMD} run --before -- <command> (failing; --judgment when the evidence is the real output)`);
}

// ── Reviews, outcomes, the ladder ────────────────────────────────────────────────────────
function parseOut(file, ids, missing = `save the reviewer's reply verbatim as ${rel(file)}`) {
  if (!fs.existsSync(file)) return { incomplete: [missing], v: {} };
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
function ladder(s, j) { // outcomes counted per level since the last PASS or level change; the nth of a kind moves on
  const o = j.outcome, from = s.level;
  if (o === 'PASS') { s.level = LADDER.pass; s.count = ZERO(); return; }
  s.count[o]++;
  const [n, to] = LADDER[from][o];
  const next = s.count[o] >= n ? to : from;
  if (next !== from) s.count = ZERO();
  s.level = next;
}
function settle(s) { // the outcome, once every NOT_MET is settled
  const j = s.entry.judged;
  if (!j || j.outcome || Object.values(j.alleged).some((x) => x.status === undefined)) return;
  const dismissed = (id) => j.alleged[id] && j.alleged[id].status === 'no';
  const est = j.scope.filter((id) => j.met.includes(id) || dismissed(id)); // only a reproduced violation blocks; missing evidence stays open
  const regress = j.scope.filter((id) => s.est.includes(id) && j.alleged[id] && j.alleged[id].reproduced);
  const fresh = est.filter((id) => !s.est.includes(id)), failed = j.scope.filter((id) => !est.includes(id));
  j.established = est;
  j.outcome = regress.length ? 'REGRESSION' : !failed.length ? 'PASS' : fresh.length ? 'ADVANCED' : 'STALLED';
  s.failed = [...new Set([...s.failed, ...Object.keys(j.alleged).filter((id) => j.alleged[id].reproduced)])];
  if (j.kind === 'gate') s.est = s.est.filter((id) => !(j.alleged[id] && j.alleged[id].status !== 'no')); // a gate certifies BASE itself
  if (['PASS', 'ADVANCED'].includes(j.outcome)) { s.est = [...new Set([...s.est, ...est])]; s.base = j.sha; } // BASE moves only forward
  else j.saved = drop(s, j.sha);
  j.from = s.level; ladder(s, j); j.to = s.level;
  if (j.kind === 'gate' && j.outcome === 'PASS') s.gateSha = j.sha;
  s.targets = j.outcome === 'PASS' ? openItems(s) : failed;
  s.history.push(j);
}
function drop(s, sha) { // a candidate never becomes BASE unjudged or rejected: save it, return to BASE
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, `rejected-${s.history.length + 1}-${sha.slice(0, 7)}.diff`);
  fs.writeFileSync(f, git(['diff', s.base, sha]).out); git(['reset', '-q', '--hard', s.base]); return rel(f);
}
function blocked(s, why) { // BLOCKED: BASE stays; a merged loop that was never judged is dropped, so the re-plan starts from BASE
  if (s.state === 'LOOP' && s.entry.merged && !(s.entry.judged && s.entry.judged.outcome) && head() !== s.base) { s.notes.push('blocked before its review; candidate saved in ' + drop(s, head())); s.entry = freshEntry(); }
  s.level = LADDER.blocked; s.blocked = why;
}

// ── Computed signals: information for the agent, never a block ───────────────────────────
function signals(s) {
  const out = [], H = s.history, fails = {};
  for (const h of H) for (const [id, x] of Object.entries(h.alleged)) if (x.reproduced) fails[id] = (fails[id] || 0) + 1;
  const again = Object.entries(fails).filter(([, n]) => n >= 2).map(([id, n]) => `${id} (${n}×)`);
  if (again.length) out.push(`the same criterion failing again: ${again.join(', ')} → step back on the class, not the instance`);
  const ret = [...new Set(H.filter((h) => h.outcome === 'REGRESSION' || h.kind === 'gate').flatMap((h) => Object.entries(h.alleged).filter(([id, x]) => x.reproduced && H.some((p) => p.t < h.t && p.established.includes(id))).map(([id]) => id)))];
  if (ret.length) out.push(`a failure returning after it was established: ${ret.join(', ')} → the earlier fix did not hold; find the shared cause`);
  const L = H.filter((h) => h.kind !== 'gate').slice(-2);
  if (L.length === 2 && L.every((h) => ['STALLED', 'REGRESSION'].includes(h.outcome)) && L[1].diff > L[0].diff) out.push(`a diff growing while nothing is established (${L[0].diff} → ${L[1].diff} lines) → remove before adding`);
  const last = H[H.length - 1];
  if (last && last.runFailed && last.met.length) out.push(`checks green while the real run fails: the run on ${last.sha.slice(0, 7)} exited non-zero, yet ${last.met.join(', ')} were judged MET → re-check the evidence`);
  return out;
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────
function counts(s) {
  const C = plan().crit.filter((c) => !c.user), k = (t) => C.filter((c) => c.tag === t), e = (arr) => arr.filter((c) => s.est.includes(c.id)).length;
  return `CORE ${e(k('CORE'))}/${k('CORE').length} · NON-CORE ${e(k('NON-CORE'))}/${k('NON-CORE').length}`;
}
const levelLine = (s) => `level ${s.level} (at this level: ADVANCED ${s.count.ADVANCED}, STALLED ${s.count.STALLED}, REGRESSION ${s.count.REGRESSION})`;
const nextLines = (s) => FLOW[s.state].next.map((t) => { const x = needs(s, t); return `- ${t}: ${x.length ? 'needs ' + x.join('; ') : 'ready'}`; });
function board(s) {
  const P = plan();
  return [`# cheapGPT board (rendered by the engine; do not edit)`, '',
    `## Task`, `${s.route} — ${s.reason} | cg/${s.slug} | state ${s.state} | ${levelLine(s)} | plan ${s.frozen ? s.frozen.slice(0, 12) + ' (frozen)' : 'not frozen'}${storeLine() ? ' | ' + storeLine() : ''}`, '',
    `## BASE`, `${(s.base || '').slice(0, 7)} | ${counts(s)}`, '',
    `## Criteria`, ...P.crit.map((c) => `- ${c.id} ${c.tag}: ${c.user ? 'the user judges' : s.est.includes(c.id) ? 'established' : 'open'}`), '',
    `## Reviews`, ...s.history.map((h) => `- ${h.t.slice(11, 19)} ${h.kind} @${(h.sha || '').slice(0, 7)} → ${h.outcome} (${h.established.length}/${h.scope.length}); level ${h.from} → ${h.to}${h.saved ? '; candidate saved in ' + h.saved : ''}`), '',
    `## Next action (the one-block)`, s.entry.block ? s.entry.block.text : `none yet: ${s.entry.prevent ? `${CMD} block "<the next action, whole>"` : 'the step back first'}`, '',
    `## Step backs`, ...s.stepbacks.map((x) => `- ${x.size}${x.targets ? ' [' + x.targets.join(',') + ']' : ''}: ${x.text.slice(0, 200)}`), '',
    `## Signals (computed)`, ...signals(s).map((x) => '- ' + x), '',
    `## Open`, ...(s.blocked ? [`- blocked: ${s.blocked}`] : []), ...(s.targets.length ? [`- targets: ${s.targets.join(', ')}`] : []), '',
    `## Vetoes`, ...s.vetoes.map((v) => '- ' + v), '', `## Backlog`, ...s.backlog.map((v) => '- ' + v), '', `## Notes`, ...s.notes.map((v) => '- ' + v), '',
    `## Next`, ...nextLines(s), ''].join('\n');
}
function report(s, final) {
  const P = plan(), j = s.history[s.history.length - 1], open = P.crit.filter((c) => !c.user && !s.est.includes(c.id)).map((c) => c.id);
  const ready = FLOW[s.state].next.find((t) => !needs(s, t).length);
  const out = [`Last: ${j ? `${j.outcome} (${j.kind}) → level ${j.to}` : 'no review yet'} — ${s.state} — ${counts(s)} — open: ${open.join(', ') || 'none'} — next: ${FLOW[s.state].terminal ? 'end' : ready || needs(s, FLOW[s.state].next[0]).join('; ')}`];
  if (j) {
    out.push('', '| criterion | tag | result | what is missing |', '|---|---|---|---|');
    for (const c of P.crit.filter((x) => !x.user)) { const a = j.alleged[c.id]; out.push(`| ${c.id} | ${c.tag} | ${s.est.includes(c.id) ? 'established' : a && a.status === 'yes' ? 'NOT_MET (reproduced)' : a && a.status === 'missing' ? 'open (evidence missing)' : a ? 'NOT_MET (unconfirmed)' : 'open'} | ${s.est.includes(c.id) ? '' : a ? (a.evidence || '').slice(0, 120) : 'not built or not in scope yet'} |`); }
    const blocks = Object.entries(j.alleged).filter(([, x]) => x.status !== 'no').map(([id, x]) => id + (x.status === 'missing' ? ' (evidence missing)' : '')), notBlock = Object.entries(j.alleged).filter(([, x]) => x.status === 'no').map(([id]) => id + ' (unconfirmed)');
    out.push('', 'Blocks: ' + (blocks.join(', ') || 'nothing'), 'Does not block: ' + ([...notBlock, ...s.backlog.map((b) => 'backlog: ' + b)].join('; ') || 'nothing'));
  }
  const sig = signals(s); if (sig.length) out.push('', 'Signals (computed): ' + sig.join('; '));
  if (final) {
    const user = P.crit.filter((c) => c.user);
    out.push('', `Delivered: cg/${s.slug} at ${head().slice(0, 7)} (gated ${(s.gateSha || '').slice(0, 7)}).`);
    if (fs.existsSync(STORE)) out.push(`Where the work is: the files on disk are the result, and your own .git sees them as uncommitted changes; the task's commits are in cheapgpt/git (${CMD} git log).`);
    if (user.length) out.push('Yours to judge:', ...user.map((c) => `- ${c.id} ${c.property} — ${(c.raw.split('judge:')[1] || '').replace(/^\s*user\s*[—-]?\s*/i, '')}`));
    if (s.vetoes.length) out.push('Vetoes: ' + s.vetoes.join('; '));
  }
  return out.join('\n');
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────
const freshEntry = () => ({ t: now(), runs: [], judged: null, prevent: null, block: null, replan: null, approved: null, merged: null, calls: [], finalReport: false, answer: null });
const [cmd, ...a] = process.argv.slice(2);
const flag = (f) => { const i = a.indexOf(f); if (i < 0) return false; a.splice(i, 1); return true; };
const opt = (f) => { const i = a.indexOf(f); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
const text = (what) => { const t = a.join(' ').trim(); if (!t) die(`write ${what} (in quotes after the command)`); return t; };
const knownIds = (ids) => { const k = plan().crit.map((c) => c.id); for (const t of ids) if (!k.includes(t)) die(`unknown criterion ${t}; the plan has ${k.join(', ')}`); return ids; };
const ROLES = ['dynamic', 'mechanical', 'breaker', 'reviewer'];

const C = {
  init() {
    const [route, slug, ...why] = a;
    if (!['FOCUSED', 'FULL'].includes(route) || !slug) die('init <FOCUSED|FULL> <slug> "<reason>" (DIRECT uses no tool)');
    if (fs.existsSync(F.state)) die(`a task exists here: ${NEXT_HINT}`);
    fs.mkdirSync(DIR, { recursive: true });
    const tracked = () => git(['ls-files']).out.split('\n').filter((f) => f && !METHOD_PATHS.some((m) => f === m || f.startsWith(m)));
    const existing = !git(['rev-parse', '--verify', 'HEAD']).code && tracked().length > 0;
    const refused = fs.existsSync(STORE) ? '' : gitProbe(slug);
    if (refused) { // the task's own repository: a clone that keeps the checkout's HEAD, with the files on disk as its working tree
      const history = !git(['rev-parse', '--verify', 'HEAD']).code; // a clone keeps the checkout's HEAD: its branch, a linked worktree's branch or a detached commit
      const r = history ? git(['clone', '--bare', '--no-hardlinks', '-q', ROOT, STORE], ROOT) : git(['init', '--bare', '-b', 'main', STORE], ROOT); if (r.code) die(`.git refuses the writes the method makes (${refused}), and cheapgpt/git could not be created:\n${r.out}`);
      git(['config', 'core.bare', 'false']); git(['remote', 'remove', 'origin']); // nothing in the store can push to the user's repository
      if (history) git(['reset', '-q']);
      const again = gitProbe(slug);
      if (again) { fs.rmSync(STORE, { recursive: true, force: true }); die(`git refuses the writes the method makes, in .git (${refused}) and in cheapgpt/git (${again}); cheapgpt/git was removed and the task folder kept: free the writes, then init again`); }
      console.log(`.git refuses the writes the method makes here (${refused}): the repository lives in cheapgpt/git${history ? ', with its history' : ''} (run git through ${CMD} git <args>)`);
    }
    const ex = path.resolve(ROOT, git(['rev-parse', '--git-dir']).out.trim(), 'info', 'exclude'); fs.mkdirSync(path.dirname(ex), { recursive: true });
    const have = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n') : [];
    fs.appendFileSync(ex, ['cheapgpt/', 'temporary/', '.cheapgpt/'].filter((w) => !have.includes(w)).map((w) => w + '\n').join(''));
    if (git(['rev-parse', '--verify', 'HEAD']).code) { const c = git(['commit', '--allow-empty', '-m', 'cheapGPT baseline']); if (c.code) die(`the baseline commit failed:\n${c.out}`); }
    const co = git(['checkout', '-q', '-B', 'cg/' + slug]); if (co.code) die(`the task branch could not be checked out:\n${co.out}`);
    const s = { version: VERSION, route, slug, reason: why.join(' '), state: FLOWDATA.start[existing ? 'existing' : 'new'], adopted: existing, entry: freshEntry(), planReview: null, frozen: null, frozenT: null, frozenSet: null, est: [], failed: [], targets: [], level: 'tiny', count: ZERO(), blocked: null, base: head(), gateSha: null, stepbacks: [], blocks: [], history: [], vetoes: [], backlog: [], notes: [], calls: {}, runs: [], snap: null };
    save(s, { ev: 'init', route, slug, existing }); console.log(`CHEAPGPT: ${route} — ${s.reason}`); C.status();
  },
  status() {
    const s = load(), T = FLOW[s.state];
    console.log(`STATE ${s.state} · ${s.route} · ${counts(s)} · ${levelLine(s)} · BASE ${(s.base || '').slice(0, 7)}${storeLine() ? ' · ' + storeLine() : ''}\n\nCARD\n${cardText({ state: s.state, level: s.level, role: 'root', route: s.route })}`);
    if (T.terminal) return;
    if (s.blocked) console.log(`\nBLOCKED (${s.blocked}): re-plan with the user`);
    if (s.state === 'LOOP') console.log('\nTARGETS\n' + (plan().crit.filter((c) => targets(s).includes(c.id)).map((c) => c.raw).join('\n') || 'none yet: name them in the step back (--targets)'));
    const j = s.entry.judged; if (j && !j.outcome) { const ids = Object.keys(j.alleged).filter((id) => j.alleged[id].status === undefined); if (ids.length) console.log('\nSETTLE before the outcome counts: ' + ids.map((id) => `reproduce ${id} yes|no -- <command> | reproduce ${id} missing "<why>"`).join(' ; ')); }
    const sig = signals(s); if (sig.length) console.log('\nSIGNALS (computed; information, never a block)\n- ' + sig.join('\n- '));
    console.log('\nNEXT\n' + nextLines(s).join('\n'));
  },
  advance() {
    const s = load(), to = a[0]; if (!FLOW[to]) die(`unknown state ${to}; ${s.state} goes to ${FLOW[s.state].next.join(', ')}`);
    const x = needs(s, to); if (x.length) die(`${s.state} → ${to} needs:\n- ` + x.join('\n- '));
    if (s.state === 'PLAN') s.targets = openItems(s);
    if (s.state === 'ACCEPT' && to === 'LOOP') { s.level = 'replan'; s.notes.push("the user's feedback at ACCEPT: " + s.entry.answer); }
    s.state = to; s.entry = freshEntry(); save(s, { ev: 'advance', to }); C.status();
  },
  freeze() { // the pre-freeze: in PLAN it starts the build; after that, only a re-plan with the user changes the list
    const s = load(), user = opt('--user'), P = plan(); allowed(s, 'freeze');
    if (P.errors.length) die('fix the plan first:\n- ' + P.errors.join('\n- '));
    const after = s.state !== 'PLAN';
    if (after && !(s.level === 'replan' && s.entry.replan)) die(`the acceptance list is frozen since the build started: only a re-plan with the user changes it (${CMD} blocked "<why>", then replan)`);
    if (s.frozenSet && P.hash !== s.frozen) {
      const removed = s.frozenSet.ids.filter((id) => !P.crit.some((c) => c.id === id)), goals = P.goals.map((g) => g.raw).join('\n') !== s.frozenSet.goals;
      const why = [...(after ? ['the build has started'] : []), ...(removed.length ? [`removed: ${removed.join(', ')}`] : []), ...(goals ? ['the goals changed'] : [])];
      if (why.length && !(user && user.trim())) die(`this change is the user's (${why.join('; ')}): ask them, then ${CMD} freeze --user "<their words>"`);
    }
    s.frozen = P.hash; s.frozenT = now(); s.frozenSet = { ids: P.crit.map((c) => c.id), goals: P.goals.map((g) => g.raw).join('\n') };
    s.est = s.est.filter((id) => P.crit.some((c) => c.id === id)); if (s.state === 'LOOP') s.targets = s.targets.filter((id) => P.crit.some((c) => c.id === id));
    save(s, { ev: 'freeze', hash: P.hash, user }); console.log(`frozen ${P.hash.slice(0, 12)}${after ? '' : `: ${CMD} advance LOOP starts the build`}`);
  },
  planreview() {
    const s = load(), id = a[0]; allowed(s, 'planreview');
    if (!s.adopted) die(`a plan review belongs to an adopted project; this one is new: ${CMD} advance LOOP`);
    if (s.planReview) die(`the plan is reviewed once and its FIX applied once: ${NEXT_HINT}`);
    if (!s.calls[id] || s.calls[id].role !== 'reviewer') die(`${id} is not a reviewer call: ${CMD} call reviewer`);
    if (!s.snap || !sameTree(s.snap, snapshot())) { s.snap = null; save(s, { ev: 'review-void', id }); die(`the repository changed during the review: void; ${CMD} redispatch ${id}, then planreview again`); }
    const out = path.join(DIR, 'runs', id, 'out.md'); if (!fs.existsSync(out)) die(`save the reviewer's reply verbatim as ${rel(out)}`);
    const m = fs.readFileSync(out, 'utf8').trim().match(/^(PASS|FIX)\b/); if (!m) die(`the reply must open with PASS or FIX (the plan-review card): ${CMD} redispatch ${id}`);
    s.snap = null; s.planReview = { verdict: m[1], t: now(), id }; save(s, { ev: 'planreview', verdict: m[1] }); console.log(`plan review: ${m[1]}${m[1] === 'FIX' ? ' — apply it once, then freeze' : ''}`);
  },
  stepback() { // the first half of a prevent: in ADOPT, PLAN and GATE on the whole, in a loop on its targets at the loop's level
    const s = load(); allowed(s, 'stepback');
    const loop = s.state === 'LOOP', given = FLOWDATA.levels.includes(a[0]) ? a.shift() : null, tg = (opt('--targets') || '').split(',').filter(Boolean);
    if (loop && given !== s.level) die(`this loop is at level ${s.level}: ${CMD} stepback ${s.level} --targets <IDs> "..."`);
    const size = loop ? given : s.state === 'PLAN' && s.route === 'FULL' ? 'full' : 'tiny';
    if (size === 'replan' && !s.entry.replan) die(`a re-plan starts with the user's words: ${CMD} replan "<their comment>"`);
    if (s.entry.prevent) die(`this ${loop ? 'loop' : 'step'} has its step back; ${s.entry.block ? `build on it: ${NEXT_HINT}` : `now its one-block: ${CMD} block "<the next action, whole>"`}`);
    if (loop) {
      if (size !== 'replan') { const pu = GUARDS.planUnchanged(s); if (pu.length) die(pu[0]); }
      if (!tg.length && size === 'replan') tg.push(...(s.entry.replan.targets || s.targets));
      if (!tg.length) die(`name the criteria this loop closes: ${CMD} stepback ${s.level} --targets <IDs> "..."`); knownIds(tg);
      const off = tg.filter((id) => !reviewable().includes(id)); if (off.length) die(`${off.join(', ')}: judged by the user at ACCEPT, never in a loop; open items: ${openItems(s).join(', ') || 'none'}`);
    } else if (tg.length) die(`in ${s.state} the step back covers the whole, without targets: ${CMD} stepback "<the whole>"`);
    const t = text('the step back (the step-back card)');
    s.entry.prevent = { t: now(), targets: tg }; s.stepbacks.push({ size, targets: tg.length ? tg : null, text: t, t: now() });
    save(s, { ev: 'stepback', size, targets: tg, text: t }); console.log(`${size} step back recorded; now the one-block: ${CMD} block "<the next action, whole>"`);
  },
  block() { // the second half of a prevent: the next action written whole on the board before it is taken
    const s = load(), file = opt('--file'), e = s.entry; allowed(s, 'block');
    if (!e.prevent) die(`the step back comes first, then the one-block: ${stepbackHint(s)}`);
    if (e.block) die(`this ${s.state === 'LOOP' ? 'loop' : 'step'} has its one-block: ${NEXT_HINT}`);
    if (file && !fs.existsSync(path.resolve(ROOT, file))) die(`no file ${file}: block --file <path> | block "<the next action, whole>"`);
    const t = file ? fs.readFileSync(path.resolve(ROOT, file), 'utf8').trim() : text('the next action, whole (the one-block card)');
    if (!t) die(`the one-block is empty: ${CMD} block "<the next action, whole>"`);
    e.block = { t: now(), text: t }; s.blocks.push({ state: s.state, level: s.level, text: t, t: now() });
    save(s, { ev: 'block', text: t }); console.log(`one-block recorded on the board (## Next action): ${NEXT_HINT}`);
  },
  replan() { // the user's comment opens the re-plan; a new comment (the user said no to the plan) starts it again
    const s = load(), tg = (opt('--targets') || '').split(',').filter(Boolean), e = s.entry; allowed(s, 'replan'); knownIds(tg);
    if (s.level !== 'replan') die(`this loop is at level ${s.level}; a re-plan comes from the ladder or a block (${CMD} blocked "<why>")`);
    if (e.merged) die(`this re-plan's build is merged: review it (${reviewHint(s)})`);
    if (!tg.length && !s.targets.length && !(e.replan && e.replan.targets)) die(`name what this re-plan closes: ${CMD} replan --targets <IDs> "<their words>"`);
    const again = !!e.replan, t = text("the user's comment");
    e.replan = { t: now(), text: t, targets: tg.length ? tg : e.replan ? e.replan.targets : null }; if (again) { e.prevent = null; e.block = null; e.approved = null; } s.blocked = null;
    save(s, { ev: 'replan', text: t, again }); console.log(again ? "re-plan started again from the user's new comment: the loop-breaker steps back on it" : "re-plan opened with the user's words");
  },
  approve() {
    const s = load(); allowed(s, 'approve');
    if (s.level !== 'replan' || !s.entry.replan) die(`approve follows the user's re-plan comment: ${CMD} replan "<their comment>"`);
    const P = plan(); if (P.errors.length || s.frozen !== P.hash) die(`freeze the new plan first (${CMD} freeze), show it to the user, then approve`);
    const tips = Object.fromEntries(s.entry.calls.filter((c) => s.calls[c].role === 'breaker').map((c) => [c, git(['rev-parse', 'cg/' + c]).out.trim()]));
    s.entry.approved = { t: now(), text: text("the user's words"), tips }; s.count = ZERO();
    save(s, { ev: 'approve', text: s.entry.approved.text }); console.log('the user approved the plan: the loop-breaker builds');
  },
  call() {
    const s = load(), role = a[0], e = s.entry;
    if (!ROLES.includes(role)) die(`call ${ROLES.join('|')}`);
    if (s.state === 'LOOP' && role !== 'reviewer' && (role === 'breaker' ? s.level === 'tiny' : s.level !== 'tiny')) die(role === 'breaker' ? `at level tiny the builders build: ${CMD} call dynamic | call mechanical` : `at level ${s.level} the loop-breaker builds alone: ${CMD} call breaker`);
    allowed(s, role === 'reviewer' ? 'call reviewer' : role === 'breaker' ? 'call breaker' : 'call builder'); // the loop-breaker's call comes before its prevent: it writes it
    let commit;
    if (role === 'reviewer') {
      if (s.state === 'LOOP') {
        if (s.route === 'FOCUSED') die(`on FOCUSED you review the loop yourself: ${reviewHint(s)}`);
        reviewReady(s);
      } else {
        const d = dirty(); if (d.length) die(`reviewers review a commit; ${d.slice(0, 3).join(', ')} uncommitted: commit it first: git commit (${CMD} git commit when the repository lives in cheapgpt/git)`);
      }
      if (s.state === 'GATE') {
        if (!e.prune) die(`the release gate records its prune first: ${CMD} prune "<what was removed>" (or none)`);
        if (!e.runs.some((r) => r.kind === 'e2e' && r.code === 0 && r.sha === head() && r.t > e.prune.t)) die(`run the product end to end on this commit first, passing: ${CMD} run --e2e -- <command>`);
      }
      commit = head(); if (!s.snap) s.snap = snapshot();
    } else {
      if (role === 'breaker' && s.level === 'full' && !openItems(s).length) die(`every item is established: nothing for the loop-breaker to fix; the release gate: ${CMD} advance GATE`);
      loopGuard(s, 'call');
      if (e.merged) die(`this loop is merged: review it (${reviewHint(s)})`);
      if (e.calls.some((c) => s.calls[c].role === role)) die(`this loop already has its ${role} call (${e.calls.filter((c) => s.calls[c].role === role)[0]}): continue it with a delta`);
      commit = s.base;
    }
    const id = crypto.randomBytes(4).toString('hex'), run = path.join(DIR, 'runs', id), wt = path.join(DIR, 'wt', id); fs.mkdirSync(run, { recursive: true });
    const r = git(['worktree', 'add', '-q', '-b', 'cg/' + id, wt, commit]); if (r.code) die(`the worktree could not be created:\n${r.out}`);
    const card = [cardText({ state: s.state, level: s.level, role, route: s.route }), ...(role === 'breaker' ? ['step-back', 'one-block'].map((c) => CARDS[c] && CARDS[c].body) : [])].filter(Boolean).join('\n\n'); // the loop-breaker takes the same prevent
    const block = ['dynamic', 'mechanical'].includes(role) ? `\n\n## The one-block (build what it names)\n${e.block.text}` : '';
    fs.writeFileSync(path.join(run, 'packet.md'), `${card}\n\n## This call\n- call: ${id} (${role})\n- commit: ${commit}\n- worktree: ${rel(wt)}${role === 'reviewer' ? '' : ` (commit your work there, on branch cg/${id})`}${block}\n\n## The assignment\n`);
    s.calls[id] = { role, commit, t: now(), worktree: wt }; e.calls.push(id); save(s, { ev: 'call', id, role, commit });
    console.log(`call ${id} (${role}) at ${commit.slice(0, 7)}\npacket: ${rel(run)}/packet.md (its card is written; append the assignment)\nreturn: ${rel(run)}/out.md (the reply, verbatim)\nworktree: ${rel(wt)}`);
  },
  merge() {
    const s = load(), ids = (a[0] || '').split(',').filter(Boolean), e = s.entry; allowed(s, 'merge'); loopGuard(s, 'merge');
    if (e.merged) die(`this loop is merged: review it (${CMD} call reviewer)`); if (!ids.length) die('merge <id>[,<id>]: the builder or loop-breaker calls of this loop');
    for (const id of ids) if (!e.calls.includes(id) || s.calls[id].role === 'reviewer') die(`${id} is not a builder or loop-breaker call of this loop; its calls: ${e.calls.filter((c) => s.calls[c].role !== 'reviewer').join(', ') || 'none'}`);
    if (head() !== s.base || dirty().length) die(`the product must be clean at BASE ${s.base.slice(0, 7)} to merge (HEAD ${head().slice(0, 7)}${dirty().length ? ', uncommitted changes' : ''}): ${CMD} git reset --hard ${s.base.slice(0, 7)} after saving anything you need`);
    const files = {};
    for (const id of ids) {
      const br = 'cg/' + id, n = +git(['rev-list', '--count', `${s.base}..${br}`]).out.trim();
      if (!n) die(`${id} committed nothing on ${br}: have it commit in its worktree, or leave it out and record the empty allocation`);
      const tip = s.level === 'replan' && e.approved.tips[id]; if (tip && tip !== s.base && !git(['merge-base', '--is-ancestor', tip, br]).code) die(`${id} has commits from before the user approved the plan: have it reset its branch to BASE (git reset --hard ${s.base.slice(0, 7)} in its worktree) and rebuild, then ${CMD} merge ${id}`);
      files[id] = git(['diff', '--name-only', s.base, br]).out.split('\n').filter(Boolean);
    }
    if (ids.length === 2) { const both = files[ids[0]].filter((f) => files[ids[1]].includes(f)); if (both.length) die(`both builders changed ${both.join(', ')}: re-allocate disjoint paths in a new loop (${CMD} advance LOOP; the merge card)`); }
    for (const id of ids) { const r = git(['merge', '-q', '--no-ff', '-m', `cheapGPT: merge ${s.calls[id].role} ${id}`, 'cg/' + id]); if (r.code) { git(['merge', '--abort']); git(['reset', '-q', '--hard', s.base]); die(`the merge conflicted; the product is back at BASE. Have the builder rebase on BASE and ${CMD} merge again, or re-allocate in a new loop (${CMD} advance LOOP):\n` + r.out.slice(0, 300)); } }
    e.merged = { t: now(), sha: head(), ids }; save(s, { ev: 'merge', ids, sha: e.merged.sha }); console.log(`merged at ${head().slice(0, 7)}; commit only the seam, then run the affected path`);
  },
  run() {
    const s = load(), kind = flag('--e2e') ? 'e2e' : flag('--before') ? 'before' : 'run', judgment = flag('--judgment');
    allowed(s, kind === 'run' ? 'run' : 'run --' + kind);
    if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die(`${CMD} run [--e2e|--before [--judgment]] -- <command>`);
    let dir = ROOT, wt = null;
    if (kind === 'before') { wt = path.join(DIR, 'wt', 'base-' + crypto.randomBytes(3).toString('hex')); const r = git(['worktree', 'add', '-q', '--detach', wt, s.base]); if (r.code) die(`the BASE worktree could not be created:\n${r.out}`); dir = wt; }
    const t0 = Date.now(), r = sh(command, [], { cwd: dir, shell: true, timeout: 3 * 3600e3 });
    const rec = { kind, command, code: r.code, sha: kind === 'before' ? s.base : head(), secs: Math.round((Date.now() - t0) / 100) / 10, t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
    if (wt) { git(['worktree', 'remove', '--force', wt]); fs.rmSync(wt, { recursive: true, force: true }); }
    s.entry.runs.push(rec); s.runs.push(rec); save(s, { ev: 'run', ...rec });
    process.stdout.write(r.out); console.log(`\n[cheapgpt] ${kind} exit ${r.code} on ${rec.sha.slice(0, 7)} in ${rec.secs}s`);
  },
  review() { // a fresh reviewer's reply (`review <id>`), or on FOCUSED loops the root's own mini-review (`review mini`)
    const s = load(), id = a[0], e = s.entry, mini = id === 'mini'; allowed(s, mini ? 'review mini' : 'review');
    if (e.judged) die(e.judged.outcome ? `this review is settled: ${NEXT_HINT}` : `settle the open NOT_MET first: ${CMD} reproduce <ID> yes|no -- <command> (or missing "<why>")`);
    let sha, file;
    if (mini) {
      if (s.route !== 'FOCUSED') die(`a FULL loop gets a fresh review: ${CMD} call reviewer, then review <id>`);
      reviewReady(s); sha = head(); file = path.join(DIR, 'mini.md');
    } else {
      if (!s.calls[id] || s.calls[id].role !== 'reviewer' || !e.calls.includes(id)) die(`${id} is not a reviewer call of this ${s.state.toLowerCase()}: ${CMD} call reviewer`);
      if (!s.snap) die(`no snapshot of the repository: ${CMD} call reviewer again`);
      const before = s.snap, after = snapshot(); s.snap = null;
      if (!sameTree(before, after)) { save(s, { ev: 'review-void', id }); die(`the repository changed during the review: void; ${CMD} redispatch ${id} with the same packet, then review again`); }
      sha = before.head; file = path.join(DIR, 'runs', id, 'out.md');
    }
    const scope = s.state === 'GATE' ? reviewable() : targets(s).filter((t) => reviewable().includes(t));
    if (!scope.length) die('nothing a reviewer can decide is in scope: name reviewable targets in the step back');
    const res = parseOut(file, scope, `write your verdict lines (the mini-review card) to ${rel(file)}`);
    if (res.incomplete.length) {
      if (mini) die(`incomplete:\n- ${res.incomplete.join('\n- ')}\ncomplete ${rel(file)}, then ${CMD} review mini`);
      if (s.calls[id].redispatched) { blocked(s, `reviewer ${id} incomplete after its re-dispatch`); save(s, { ev: 'review-incomplete', id, blocked: true }); die(`incomplete after its re-dispatch: blocked → a re-plan with the user (${CMD} replan "<their comment>")\n- ${res.incomplete.join('\n- ')}`); }
      save(s, { ev: 'review-incomplete', id }); die(`incomplete:\n- ${res.incomplete.join('\n- ')}\n${CMD} redispatch ${id} once with the same packet, then review again`);
    }
    if (mini) { e.mini = fs.readFileSync(file, 'utf8'); fs.rmSync(file); } // kept in the record; removed so no later loop reuses it
    const alleged = {}; for (const c of scope) if (res.v[c] === 'NOT_MET') alleged[c] = {};
    const kind = s.state === 'GATE' ? 'gate' : mini ? 'mini' : 'loop', runs = e.runs.filter((r) => r.kind !== 'before' && r.sha === sha);
    e.judged = { kind, sha, scope, met: scope.filter((c) => res.v[c] === 'MET'), alleged, t: now(), outcome: null, established: [], diff: diffSize(s.base, sha), runFailed: runs.length > 0 && runs[runs.length - 1].code !== 0 };
    settle(s); save(s, { ev: 'review', kind, met: e.judged.met, alleged: Object.keys(alleged), outcome: e.judged.outcome }); C.status();
  },
  reproduce() { // the engine runs the reproduction itself, so the verdict rests on a witnessed run, not on a report of one
    const s = load(), id = a.shift(), st = a.shift(), judgment = flag('--judgment'), j = s.entry.judged;
    if (!j || !j.alleged[id] || j.alleged[id].status !== undefined) die(`no open NOT_MET ${id || ''} to settle: ${NEXT_HINT}`);
    if (!['yes', 'missing', 'no'].includes(st)) die(`reproduce ${id} yes|no [--judgment] -- <command> (the engine runs it: yes needs it to fail, no to pass) | reproduce ${id} missing "<the run that could not be made, and why>" (the criterion stays open, not a defect)`);
    let evidence;
    if (st === 'missing') evidence = text('the run that could not be made, and why');
    else {
      if (a[0] === '--') a.shift(); const command = a.join(' '); if (!command) die(`reproduce ${id} ${st} [--judgment] -- <the command that decides it>`);
      const r = sh(command, [], { shell: true, timeout: 3 * 3600e3 }), ok = st === 'yes' ? r.code !== 0 : r.code === 0;
      const rec = { kind: 'reproduce', id, command, code: r.code, sha: head(), t: now(), tail: r.out.split('\n').slice(-12).join('\n'), judgment };
      s.entry.runs.push(rec); s.runs.push(rec); process.stdout.write(r.out);
      if (!ok && !judgment) { save(s, { ev: 'run', ...rec }); die(`the run exited ${r.code}, which does not show "${st}": ${st === 'yes' ? 'a violation fails the command' : 'a holding criterion passes it'}; settle with the right verdict (${CMD} reproduce ${id} yes|no -- <command>), or add --judgment when the evidence is the real output rather than the exit code`); }
      evidence = `${command} → exit ${r.code}${judgment ? ' (judged on its output)' : ''}: ${rec.tail.slice(-200)}`;
    }
    j.alleged[id].status = st; j.alleged[id].reproduced = st === 'yes'; j.alleged[id].evidence = evidence;
    settle(s); save(s, { ev: 'reproduce', id, status: st, evidence }); C.status();
  },
  redispatch() {
    const s = load(), id = a[0]; if (!s.calls[id]) die(`unknown call ${id}; calls: ${Object.keys(s.calls).join(', ') || 'none'}`);
    if (s.calls[id].redispatched) die(`${id} was re-dispatched once already; a second failure is a block: ${CMD} blocked "<what failed>"`);
    s.calls[id].redispatched = true; const wt = s.calls[id].worktree; git(['reset', '-q', '--hard', s.calls[id].commit], wt); git(['clean', '-qfdx'], wt);
    if (s.calls[id].role === 'reviewer') s.snap = snapshot(); save(s, { ev: 'redispatch', id }); console.log(`re-dispatch ${id} with the same packet; its reply replaces out.md`);
  },
  blocked() { const s = load(); allowed(s, 'blocked'); const t = text('what blocks the work'); blocked(s, t); save(s, { ev: 'blocked', text: t }); console.log('blocked: the next loop is a re-plan with the user'); },
  prune() { const s = load(); allowed(s, 'prune'); s.entry.prune = { t: now(), text: text('what was removed, or none') }; save(s, { ev: 'prune', text: s.entry.prune.text }); console.log('prune recorded; commit, then run --e2e on that commit'); },
  answer() { const s = load(); allowed(s, 'answer'); s.entry.answer = text("the user's words"); save(s, { ev: 'answer', text: s.entry.answer }); console.log('answer recorded'); },
  report() { const s = load(), final = flag('--final'); if (final) { allowed(s, 'report --final'); s.entry.finalReport = true; save(s, { ev: 'report', final }); } console.log(report(s, final)); },
  veto() { const s = load(); s.vetoes.push(text('the veto: what failed and its replacement')); save(s, { ev: 'veto', text: a.join(' ') }); console.log('veto recorded'); },
  backlog() { const s = load(); s.backlog.push(text('the backlog item')); save(s, { ev: 'backlog', text: a.join(' ') }); console.log('backlog recorded'); },
  note() { const s = load(); s.notes.push(text('the note')); save(s, { ev: 'note', text: a.join(' ') }); console.log('note recorded'); },
  clean() {
    const s = load(); allowed(s, 'clean');
    for (const id of Object.keys(s.calls)) { git(['worktree', 'remove', '--force', s.calls[id].worktree]); git(['branch', '-q', '-D', 'cg/' + id]); }
    git(['worktree', 'prune']);
    for (const d of fs.readdirSync(DIR)) if (!['git', 'reports'].includes(d)) fs.rmSync(path.join(DIR, d), { recursive: true, force: true });
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log('task files removed (cheapgpt/git and cheapgpt/reports kept)');
  },
  git() { const r = git(a); process.stdout.write(r.out); process.exit(r.code); },
  check() { // flow and cards: every state reachable and able to end, every guard known, every binding resolved, every card bound
    const errs = [], states = Object.keys(FLOW);
    for (const [k, v] of Object.entries(FLOW)) {
      for (const t of v.next) if (!FLOW[t]) errs.push(`${k} → ${t}: unknown state`);
      for (const g of [...(v.exit || []), ...Object.values(v.to || {}).flat()]) if (!GUARDS[g]) errs.push(`${k}: unknown guard ${g}`);
    }
    for (const k of states) { const seen = new Set([k]), q = [k]; let ok = false; while (q.length) { const x = q.shift(); if (FLOW[x].terminal) { ok = true; break; } for (const t of FLOW[x].next) if (!seen.has(t)) { seen.add(t); q.push(t); } } if (!ok) errs.push(k + ': cannot end'); }
    const reach = new Set(Object.values(FLOWDATA.start)), q = [...reach]; while (q.length) for (const t of FLOW[q.shift()].next) if (!reach.has(t)) { reach.add(t); q.push(t); }
    for (const k of states) if (!reach.has(k)) errs.push(k + ': unreachable');
    for (const [k, cmds] of Object.entries(FLOWDATA.prevent || {})) for (const c of cmds) if (!FLOW[k] || !(FLOWDATA.commands[c] || []).includes(k)) errs.push(`prevent ${k}: ${c} is not a command of ${k}`);
    for (const l of FLOWDATA.levels) for (const o of ['ADVANCED', 'STALLED', 'REGRESSION']) if (!LADDER[l] || !LADDER[l][o] || !FLOWDATA.levels.includes(LADDER[l][o][1])) errs.push(`ladder ${l}/${o}: missing or unknown level`);
    for (const k of states) { const lv = k === 'LOOP' ? FLOWDATA.levels : [undefined]; for (const l of lv) if (!bound({ state: k, level: l, role: 'root' }).length) errs.push(`${k}${l ? '/' + l : ''}: no root card bound`); }
    for (const r of ROLES) for (const k of ['LOOP']) if (!bound({ state: k, level: r === 'breaker' ? 'full' : 'tiny', role: r }).length) errs.push(`${k}: no card bound for role ${r}`);
    for (const b of FLOWDATA.cards) { const c = CARDS[b.card]; if (!c || !c.body) errs.push(`binding ${b.state}${b.level ? '/' + b.level : ''}/${b.role}: card "${b.card}" missing`); else if (!c.states.includes(b.state) || (c.level || undefined) !== b.level || c.role !== b.role || (c.route || undefined) !== b.route) errs.push(`card "${b.card}": front matter (${c.state}${c.level ? '/' + c.level : ''}/${c.role}${c.route ? '/' + c.route : ''}) differs from flow.json (${b.state}${b.level ? '/' + b.level : ''}/${b.role}${b.route ? '/' + b.route : ''})`); }
    for (const [id, c] of Object.entries(CARDS)) { if (c.bad) errs.push(`${c.file}: ${c.bad}`); else if (!FLOWDATA.cards.some((b) => b.card === id)) errs.push(`card "${id}" (${c.file}) is bound to nothing in flow.json`); }
    console.log(errs.length ? 'FLOW INVALID\n- ' + errs.join('\n- ') : `FLOW OK: ${states.length} states, each reachable and able to end; ${Object.keys(CARDS).length} cards, each bound; ladder levels ${FLOWDATA.levels.join(', ')}`);
    process.exit(errs.length ? 1 : 0);
  },
  flow() {
    const L = FLOWDATA.levels.map((l) => `${l}: ` + ['ADVANCED', 'STALLED', 'REGRESSION'].map((o) => `${o} ${LADDER[l][o][0] === 1 ? '→ ' + LADDER[l][o][1] : `stays (${ordinal(LADDER[l][o][0])} → ${LADDER[l][o][1]})`}`).join(' · '));
    console.log(Object.entries(FLOW).map(([k, v]) => `${k} → ${v.next.join(', ') || '(end)'}`).join('\n') + `\n\nLADDER (counted per level since the last PASS or level change; PASS → ${LADDER.pass}; BLOCKED → ${LADDER.blocked})\n` + L.join('\n'));
  },
  card() { const id = a[0]; if (!CARDS[id] || !CARDS[id].body) die(`unknown card ${id}; cards: ${Object.keys(CARDS).join(', ')}`); console.log(CARDS[id].body); },
  version() { console.log(VERSION); },
};
const ordinal = (n) => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
if (!C[cmd]) { console.log('cheapgpt.mjs ' + VERSION + '\ncommands: ' + Object.keys(C).join(' ')); process.exit(cmd ? 2 : 0); }
C[cmd]();
