#!/usr/bin/env node
// The README's flow diagram, generated from flow.json so the two cannot drift.
//   node tools/flow-diagram.mjs           rewrite the block between <!-- flow:start --> and <!-- flow:end --> in README.md
//   node tools/flow-diagram.mjs --check   exit 1 when README.md differs from what flow.json generates
//   --flow <path> --readme <path>         other files (tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const flowPath = opt('--flow', path.join(ROOT, 'flow.json')), readmePath = opt('--readme', path.join(ROOT, 'README.md'));
const START = '<!-- flow:start (generated from flow.json by tools/flow-diagram.mjs; do not edit) -->', END = '<!-- flow:end -->';

function diagram(flow) {
  const lines = ['```mermaid', 'flowchart LR'];
  for (const [k, v] of Object.entries(flow.states)) for (const t of v.next) lines.push(`  ${k} --> ${t}`);
  lines.push('  subgraph ladder [loop levels]', '    direction LR');
  const edges = {}, nth = (n) => (n === 1 ? '' : n === 2 ? '2nd ' : n === 3 ? '3rd ' : `${n}th `);
  for (const from of flow.levels) for (const o of ['ADVANCED', 'STALLED', 'REGRESSION']) {
    const [n, to] = flow.ladder[from][o]; if (to === from) continue;
    (edges[`${from}|${to}`] ||= []).push(nth(n) + o);
  }
  edges[`tiny|${flow.ladder.firstCoreStalled}`] = [...(edges[`tiny|${flow.ladder.firstCoreStalled}`] || []), 'first core loop STALLED'];
  for (const [k, labels] of Object.entries(edges)) { const [from, to] = k.split('|'); lines.push(`    ${from} -->|${labels.join(', ')}| ${to}`); }
  lines.push(`    full -->|PASS| ${flow.ladder.pass}`, `    replan -->|PASS| ${flow.ladder.pass}`, '  end', '```');
  return lines.join('\n');
}

const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8')), readme = fs.readFileSync(readmePath, 'utf8');
const a = readme.indexOf(START), b = readme.indexOf(END);
if (a < 0 || b < a) { console.error(`${readmePath}: no flow block (${START} … ${END})`); process.exit(1); }
const next = readme.slice(0, a) + START + '\n' + diagram(flow) + '\n' + readme.slice(b);
if (args.includes('--check')) {
  if (next !== readme) { console.error('README flow diagram differs from flow.json: run node tools/flow-diagram.mjs'); process.exit(1); }
  console.log('README flow diagram matches flow.json');
} else { fs.writeFileSync(readmePath, next); console.log('README flow diagram written'); }
