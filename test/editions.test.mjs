// The entry point: --edition picks the installer and profiles; without it a project keeps its installed edition.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const install = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, "install.mjs"), ...args], { encoding: "utf8" }); return { code: r.status, out: r.stdout + r.stderr }; };
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), "cg-ed-"));
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".cheapgpt", "state.json"), "utf8"));

test("each edition installs its own instruction file and profile; update and doctor keep the installed edition", () => {
  const cases = { codex: ["AGENTS.md", /gpt-6\.1-sol/, false], claude: ["CLAUDE.md", /Sonnet 5\.5/, false], exp: ["CLAUDE.md", /codex exec resume/, true] };
  for (const [edition, [file, marker, codexPermission]] of Object.entries(cases)) {
    const dir = project();
    try {
      const r = install("install", "--project", dir, "--profile", "cheap", "--edition", edition);
      assert.equal(r.code, 0, r.out);
      assert.match(fs.readFileSync(path.join(dir, file), "utf8"), marker);
      assert.equal(Boolean(state(dir).codexPermission), codexPermission);
      const u = install("update", "--project", dir, "--profile", "cheap-100");
      assert.equal(u.code, 0, u.out);
      assert.match(fs.readFileSync(path.join(dir, file), "utf8"), marker, `${edition}: update kept the edition`);
      assert.match(install("doctor", "--project", dir).out, /doctor: ok/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a plain install is codex; another --edition on an installed project, or an unknown one, is refused", () => {
  const dir = project();
  try {
    assert.equal(install("install", "--project", dir, "--profile", "cheap").code, 0);
    assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")) && !fs.existsSync(path.join(dir, "CLAUDE.md")));
    const other = install("update", "--project", dir, "--edition", "exp");
    assert.notEqual(other.code, 0); assert.match(other.out, /has the codex edition installed; to change it, run uninstall first, then install --edition exp/);
    const unknown = install("install", "--project", project(), "--profile", "cheap", "--edition", "claude-edition");
    assert.notEqual(unknown.code, 0); assert.match(unknown.out, /unknown edition 'claude-edition'; the editions are codex, claude, exp/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
