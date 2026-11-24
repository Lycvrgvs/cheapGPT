// The engine's data in the repository: flow.json and cards/ agree with each other and with the README diagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

test('flow.json and cards/ validate: every state reachable and able to end, every card bound', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-check-'));
  const r = node([path.join(ROOT, 'cheapgpt.mjs'), 'check'], tmp);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /FLOW OK/);
});

test('the README flow diagram matches flow.json, and a changed flow.json fails the check', () => {
  const ok = node([path.join(ROOT, 'tools', 'flow-diagram.mjs'), '--check']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-flow-')), flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'flow.json'), 'utf8'));
  flow.ladder.tiny.STALLED = [3, 'full'];
  fs.writeFileSync(path.join(tmp, 'flow.json'), JSON.stringify(flow)); fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(tmp, 'README.md'));
  const bad = node([path.join(ROOT, 'tools', 'flow-diagram.mjs'), '--check', '--flow', path.join(tmp, 'flow.json'), '--readme', path.join(tmp, 'README.md')]);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /differs from flow\.json/);
});
