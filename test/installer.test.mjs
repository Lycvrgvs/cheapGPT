import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  END_MARKER,
  START_MARKER,
  applyManagedBlock,
  buildManagedBlock,
  cheapgptHookCount,
  extractManagedRegion,
  extractProfileFromBlock,
  loadProfile,
  mergeCheapgptHooks,
  run,
  sha256,
} from "../install.mjs";
import { mergeMultiAgentConfig } from "../codex-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = path.join(ROOT, "install.mjs");
const HOOK = path.join(ROOT, "hooks", "cheapgpt-turn.mjs");

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "cheapgpt-"));
}

async function cli(project, args, env = {}) {
  return run(["node", INSTALL, ...args, "--project", project], { sourceRoot: ROOT });
}

function countMarkers(text) {
  return {
    start: text.split(START_MARKER).length - 1,
    end: text.split(END_MARKER).length - 1,
  };
}

test("empty repository install creates AGENTS.md, one block, state, and doctor passes", async () => {
  const dir = await tempDir();
  try {
    const result = await cli(dir, ["install", "--profile", "ultracheap"]);
    assert.equal(result.ok, true);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const markers = countMarkers(agents);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
    const profile = await loadProfile("ultracheap", ROOT);
    const inner = extractProfileFromBlock(agents, "ultracheap");
    assert.equal(inner, profile.body.trim());
    assert.match(agents, /luna-6-max/);
    assert.doesNotMatch(agents, /sol-6-high/);
    assert.doesNotMatch(agents, /sol-6-xhigh/);
    assert.doesNotMatch(agents, /sol-6-max/);
    assert.doesNotMatch(agents, /gpt-5\.6-sol xhigh/);
    const state = JSON.parse(await readFile(path.join(dir, ".cheapgpt", "state.json"), "utf8"));
    assert.equal(state.profile, "ultracheap");
    assert.equal(state.hookMode, "codex");
    const region = extractManagedRegion(agents);
    assert.equal(state.managedBlockSha256, sha256(region.block));
    assert.equal(existsSync(path.join(dir, ".codex", "hooks", "cheapgpt-turn.mjs")), true);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /\[features\.multi_agent_v2\]/);
    assert.match(toml, /default_wait_timeout_ms = 1800000/);
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing AGENTS.md user instructions survive installation", async () => {
  const dir = await tempDir();
  try {
    const original = "# Repository Rules\n\nRun npm test before completion.\n";
    await writeFile(path.join(dir, "AGENTS.md"), original);
    await cli(dir, ["install", "--profile", "cheap"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /Run npm test before completion\./);
    assert.match(agents, /gpt-6\.1-sol at medium effort/);
    assert.ok(agents.startsWith("# Repository Rules"));
    const markers = countMarkers(agents);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install is idempotent and never duplicates the managed block", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const first = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const second = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const markers = countMarkers(second);
    assert.equal(markers.start, 1);
    assert.equal(markers.end, 1);
    assert.equal(extractManagedRegion(first).block, extractManagedRegion(second).block);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each profile installs only that profile's unique root text", async () => {
  const cases = [
    ["ultracheap", "luna-6-max", ["gpt-6.1-sol at medium effort", "gpt-6.1-sol at xhigh effort"]],
    ["cheap", "gpt-6.1-sol at medium effort", ["luna-6-max", "gpt-6.1-sol at xhigh effort"]],
    ["cheap-100", "gpt-6.1-sol at xhigh effort", ["luna-6-max", "gpt-6.1-sol at medium effort"]],
  ];
  for (const [profile, unique, absent] of cases) {
    const dir = await tempDir();
    try {
      await cli(dir, ["install", "--profile", profile, "--no-hooks"]);
      const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
      assert.match(agents, new RegExp(unique.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      for (const other of absent) {
        assert.equal(agents.includes(other), false, `${profile} unexpectedly contains ${other}`);
      }
      const loaded = await loadProfile(profile, ROOT);
      assert.equal(extractProfileFromBlock(agents, profile), loaded.body.trim());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("update replaces only CheapGPT-owned content and can switch profiles", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "Keep me.\n");
    await cli(dir, ["install", "--profile", "ultracheap"]);
    await cli(dir, ["update", "--profile", "cheap"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /Keep me\./);
    assert.match(agents, /gpt-6\.1-sol at medium effort/);
    assert.match(agents, /mechanical builder/);
    assert.doesNotMatch(agents, /roughly 5000 tokens/);
    assert.equal(countMarkers(agents).start, 1);
    const state = JSON.parse(await readFile(path.join(dir, ".cheapgpt", "state.json"), "utf8"));
    assert.equal(state.profile, "cheap");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("modified managed block fails doctor and update unless --force", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const agentsPath = path.join(dir, "AGENTS.md");
    const agents = await readFile(agentsPath, "utf8");
    await writeFile(agentsPath, agents.replace("Preferred-root guidance", "TAMPERED-root guidance"));
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, false);
    await assert.rejects(() => cli(dir, ["update"]), /modified by hand/);
    const forced = await cli(dir, ["update", "--force"]);
    assert.equal(forced.ok, true);
    const restored = await readFile(agentsPath, "utf8");
    assert.match(restored, /Preferred-root guidance/);
    assert.doesNotMatch(restored, /TAMPERED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed markers fail without modifying the file", async () => {
  const dir = await tempDir();
  try {
    const broken = `# Rules\n\n${START_MARKER}\npartial\n`;
    await writeFile(path.join(dir, "AGENTS.md"), broken);
    await assert.rejects(() => cli(dir, ["install", "--profile", "ultracheap"]), /malformed/);
    const after = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.equal(after, broken);
    assert.equal(existsSync(path.join(dir, ".cheapgpt", "state.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate managed blocks fail safely", async () => {
  const dir = await tempDir();
  try {
    const profile = await loadProfile("ultracheap", ROOT);
    const block = buildManagedBlock("ultracheap", profile.body);
    await writeFile(path.join(dir, "AGENTS.md"), block + "\n" + block);
    await assert.rejects(() => cli(dir, ["install", "--profile", "ultracheap"]), /malformed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uninstall removes CheapGPT files and preserves user instructions", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "User rules stay.\n");
    await cli(dir, ["install", "--profile", "cheap-100"]);
    await cli(dir, ["uninstall"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /User rules stay\./);
    assert.equal(agents.includes(START_MARKER), false);
    assert.equal(existsSync(path.join(dir, ".cheapgpt", "state.json")), false);
    assert.equal(existsSync(path.join(dir, ".codex", "hooks", "cheapgpt-turn.mjs")), false);
    const hooksRaw = await readFile(path.join(dir, ".codex", "hooks.json"), "utf8").catch(() => "{}");
    const counts = cheapgptHookCount(hooksRaw);
    assert.equal(counts.heartbeat, 0);
    assert.equal(counts.recovery, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry-run never mutates the filesystem", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "untouched\n");
    const result = await cli(dir, ["install", "--profile", "ultracheap", "--dry-run"]);
    assert.equal(result.dryRun, true);
    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf8"), "untouched\n");
    assert.equal(existsSync(path.join(dir, ".cheapgpt")), false);
    assert.equal(existsSync(path.join(dir, ".codex")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed transaction restores original project files", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "original\n");
    const previous = process.env.CHEAPGPT_FAIL_AFTER;
    process.env.CHEAPGPT_FAIL_AFTER = "state";
    try {
      await assert.rejects(() => cli(dir, ["install", "--profile", "ultracheap"]), /induced failure/);
    } finally {
      if (previous == null) delete process.env.CHEAPGPT_FAIL_AFTER;
      else process.env.CHEAPGPT_FAIL_AFTER = previous;
    }
    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf8"), "original\n");
    assert.equal(existsSync(path.join(dir, ".cheapgpt", "state.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unrelated existing hooks survive and CheapGPT hooks are idempotent", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const existing = {
      description: "team hooks",
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo team", statusMessage: "team-bash" }],
          },
        ],
      },
    };
    await writeFile(path.join(dir, ".codex", "hooks.json"), JSON.stringify(existing, null, 2));
    await cli(dir, ["install", "--profile", "ultracheap"]);
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const hooks = JSON.parse(await readFile(path.join(dir, ".codex", "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].statusMessage, "team-bash");
    const counts = cheapgptHookCount(JSON.stringify(hooks));
    assert.equal(counts.heartbeat, 1);
    assert.equal(counts.recovery, 1);
    await cli(dir, ["uninstall"]);
    const after = JSON.parse(await readFile(path.join(dir, ".codex", "hooks.json"), "utf8"));
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "echo team");
    assert.equal(after.hooks.UserPromptSubmit, undefined);
    assert.equal(after.hooks.SessionStart, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--global is refused", async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(
      () => cli(dir, ["install", "--profile", "ultracheap", "--global"]),
      /project-local only/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildManagedBlock wrapper stays short and preserves profile bytes", async () => {
  const profile = await loadProfile("cheap-100", ROOT);
  const block = buildManagedBlock("cheap-100", profile.body);
  assert.ok(block.startsWith(START_MARKER));
  assert.ok(block.includes(END_MARKER));
  assert.equal(extractProfileFromBlock(block, "cheap-100"), profile.body.trim());
  assert.equal(applyManagedBlock("", block), block.endsWith("\n") ? block : `${block}\n`);
});

function runHook(cwd, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

test("heartbeat hook uses nested Codex contract and includes turn_id", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const result = await runHook(dir, {
      hook_event_name: "UserPromptSubmit",
      cwd: dir,
      model: "gpt-5-based-codex",
      turn_id: "turn-abc-123",
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.equal(typeof ctx, "string");
    assert.match(ctx, /CHEAPGPT HEARTBEAT: hook executed for current turn_id=turn-abc-123/);
    assert.match(ctx, /CHEAPGPT ACTIVE: profile=ultracheap/);
    assert.match(ctx, /Preferred profile root: luna-6-max/);
    assert.match(ctx, /CHEAPGPT TURN REMINDER/);
    assert.doesNotMatch(ctx, /PLANNING MODE:/);
    assert.doesNotMatch(ctx, /IMPLEMENTATION MODE:/);
    assert.ok(ctx.length < 6000);
    assert.doesNotMatch(ctx, /You are the persistent Luna xHigh root orchestrator/);
    assert.doesNotMatch(ctx, /stop and ask the user to switch/);
    assert.doesNotMatch(ctx, /remain idle/);
    assert.doesNotMatch(ctx, /If this slug is not that root/);
    assert.doesNotMatch(ctx, /do not spawn Astra/);
    assert.match(ctx, /do not request substitute-root approval/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compact recovery uses nested SessionStart contract and rehydrates the managed block", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "cheap"]);
    const agents = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const block = extractManagedRegion(agents).block;
    const result = await runHook(dir, {
      hook_event_name: "SessionStart",
      source: "compact",
      cwd: dir,
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.match(ctx, /CHEAPGPT RECOVERY: SessionStart source=compact succeeded/);
    assert.ok(ctx.includes(block.trim()));
    assert.match(ctx, /gpt-6\.1-sol at medium effort/);
    assert.match(ctx, /CHEAPGPT cheap\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed CheapGPT state fails safely without blocking", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".cheapgpt"), { recursive: true });
    await writeFile(path.join(dir, ".cheapgpt", "state.json"), "{not-json");
    const result = await runHook(dir, {
      hook_event_name: "UserPromptSubmit",
      cwd: dir,
    });
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continue, true);
    assert.match(payload.systemMessage, /unreadable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeCheapgptHooks refuses malformed hooks.json", () => {
  assert.throws(() => mergeCheapgptHooks("{bad", true), /not valid JSON/);
});

test("profiles keep their required structure and no blocking root-identity gate", async () => {
  const legacy = await readFile(path.join(ROOT, "profiles", "ultracheap.md"), "utf8");
  for (const need of [/CavePrompt/, /UNRESOLVED/, /Preferred-root guidance:/, /FIX_NO_PLAN_CHANGES/, /RAPID/, /roughly 15000 tokens/]) assert.match(legacy, need);
  for (const id of ["cheap", "cheap-100"]) {
    const text = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    for (const need of [/## FLOW/, /END_FLOW/, /## MECHANICS/, /END_MECHANICS/, /## LAWS/, /## NOISE_VETO/, /## SIGNALS/, /\.cheapgpt\/cheapgpt\.mjs/, /The step back/, /native `spawn_agent`/]) assert.match(text, need);
    assert.match(text, new RegExp(`^PROFILE: ${id}\\n`));
  }
  for (const id of ["ultracheap", "cheap", "cheap-100"]) {
    const text = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    assert.doesNotMatch(text, /Required-root check:/);
    assert.doesNotMatch(text, /remain idle except/);
    assert.doesNotMatch(text, /You are the persistent (Luna|Sol-high|gpt-5\.6-sol|luna-6|sol-6)/);
  }
});

test("catalog carries one turn reminder per profile and no full modes", async () => {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "profiles", "catalog.json"), "utf8"));
  for (const id of ["ultracheap", "cheap", "cheap-100"]) {
    const meta = catalog.profiles[id];
    assert.match(meta.planningMode, /^CHEAPGPT /);
    assert.equal(meta.implementationMode, "");
    assert.doesNotMatch(meta.planningMode, /PLANNING MODE:/);
    assert.doesNotMatch(meta.planningMode, /IMPLEMENTATION MODE:/);
    assert.ok(meta.planningMode.length < 4000);
  }
});

test("only cheap-100 routes its loop-breaker through Astra", async () => {
  for (const id of ["ultracheap", "cheap"]) {
    const text = await readFile(path.join(ROOT, "profiles", `${id}.md`), "utf8");
    assert.doesNotMatch(text, /Astra|astra/);
  }
  const text = await readFile(path.join(ROOT, "profiles", "cheap-100.md"), "utf8");
  assert.match(text, /gpt-6-astra, xhigh/);
});

test("doctor warns when installed packageVersion or hook script is stale", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const statePath = path.join(dir, ".cheapgpt", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.packageVersion = "1.1.0";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(dir, ".codex", "hooks", "cheapgpt-turn.mjs"), "export default 'stale';\n");
    const doctor = await cli(dir, ["doctor"]);
    assert.equal(doctor.ok, true);
    assert.ok(doctor.warnings.some((w) => /packageVersion 1\.1\.0/.test(w)));
    assert.ok(doctor.warnings.some((w) => /hook script does not match current sources/.test(w)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing unrelated Codex config survives outside the CheapGPT TOML block", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const original = "model = \"gpt-5\"\n\n[mcp_servers.demo]\ncommand = \"echo\"\n";
    await writeFile(path.join(dir, ".codex", "config.toml"), original);
    await cli(dir, ["install", "--profile", "ultracheap"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /model = "gpt-5"/);
    assert.match(toml, /\[mcp_servers\.demo\]/);
    assert.match(toml, /cheapgpt:multi-agent-v2:start/);
    assert.equal(toml.split("[features.multi_agent_v2]").length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing matching multi-agent values stay user-owned and are not duplicated", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(
      path.join(dir, ".codex", "config.toml"),
      `[features.multi_agent_v2]
enabled = true
wait_agent_enabled = true
expose_spawn_agent_model_overrides = true
min_wait_timeout_ms = 60000
default_wait_timeout_ms = 1800000
max_wait_timeout_ms = 3600000
`
    );
    await cli(dir, ["install", "--profile", "cheap", "--no-hooks"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.equal((toml.match(/^\s*enabled = true\s*$/gm) || []).length, 1);
    assert.doesNotMatch(toml, /cheapgpt:multi-agent-v2:start/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing table receives only missing keys without a duplicate table", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(
      path.join(dir, ".codex", "config.toml"),
      `[features.multi_agent_v2]
enabled = true
`
    );
    await cli(dir, ["install", "--profile", "cheap-100"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.equal(toml.split("[features.multi_agent_v2]").length - 1, 1);
    assert.match(toml, /wait_agent_enabled = true/);
    assert.match(toml, /cheapgpt:multi-agent-v2:start/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("update keeps the CheapGPT-created multi-agent table across repeated updates", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "cheap"]);
    for (let i = 0; i < 3; i += 1) {
      await cli(dir, ["update"]);
      const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
      assert.equal(toml.split("[features.multi_agent_v2]").length - 1, 1);
      assert.match(toml, /default_wait_timeout_ms = 1800000/);
      const doctor = await cli(dir, ["doctor"]);
      assert.equal(doctor.ok, true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conflicting multi-agent values fail without rewriting config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    const original = "[features.multi_agent_v2]\nenabled = false\n";
    await writeFile(path.join(dir, ".codex", "config.toml"), original);
    await assert.rejects(() => cli(dir, ["install", "--profile", "ultracheap"]), /config conflict/);
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uninstall removes only CheapGPT TOML and dry-run does not touch config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "keep = true\n");
    const dry = await cli(dir, ["install", "--profile", "ultracheap", "--dry-run"]);
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), "keep = true\n");
    assert.ok(dry.writes.includes(".codex/config.toml"));
    await cli(dir, ["install", "--profile", "ultracheap"]);
    await cli(dir, ["uninstall"]);
    const toml = await readFile(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /keep = true/);
    assert.doesNotMatch(toml, /cheapgpt:multi-agent-v2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("transaction failure restores original Codex config", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "keep = 1\n");
    const previous = process.env.CHEAPGPT_FAIL_AFTER;
    process.env.CHEAPGPT_FAIL_AFTER = "state";
    try {
      await assert.rejects(() => cli(dir, ["install", "--profile", "ultracheap"]), /induced failure/);
    } finally {
      if (previous == null) delete process.env.CHEAPGPT_FAIL_AFTER;
      else process.env.CHEAPGPT_FAIL_AFTER = previous;
    }
    assert.equal(await readFile(path.join(dir, ".codex", "config.toml"), "utf8"), "keep = 1\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeMultiAgentConfig refuses dotted keys", () => {
  assert.throws(
    () => mergeMultiAgentConfig("features.multi_agent_v2.enabled = true\n"),
    /dotted-key/
  );
});

test("--agents-md-limit 96k writes project_doc_max_bytes, update keeps it, default and uninstall remove it", async () => {
  const dir = await tempDir();
  const config = path.join(dir, ".codex", "config.toml");
  try {
    await cli(dir, ["install", "--profile", "cheap", "--agents-md-limit", "96k"]);
    let text = await readFile(config, "utf8");
    assert.match(text, /^# cheapgpt:agents-md-limit:start\nproject_doc_max_bytes = 98304\n# cheapgpt:agents-md-limit:end\n/);
    assert.equal((await cli(dir, ["doctor"])).ok, true);
    await cli(dir, ["update"]);
    text = await readFile(config, "utf8");
    assert.equal(text.split("project_doc_max_bytes").length - 1, 1);
    await cli(dir, ["update", "--agents-md-limit", "default"]);
    text = await readFile(config, "utf8");
    assert.doesNotMatch(text, /project_doc_max_bytes/);
    await cli(dir, ["update", "--agents-md-limit", "96k"]);
    await cli(dir, ["uninstall"]);
    assert.equal(existsSync(config), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--agents-md-limit refuses a user-owned project_doc_max_bytes and bad values", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".codex"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "config.toml"), "project_doc_max_bytes = 65536\n");
    await assert.rejects(cli(dir, ["install", "--profile", "cheap", "--agents-md-limit", "96k"]), /already set/);
    await assert.rejects(cli(dir, ["install", "--profile", "cheap", "--agents-md-limit", "64k"]), /96k or default/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor warns when AGENTS.md exceeds Codex's read limit, and not after --agents-md-limit 96k", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "AGENTS.md"), `# Team rules\n\n${"x".repeat(40000)}\n`);
    await cli(dir, ["install", "--profile", "cheap"]);
    let doctor = await cli(dir, ["doctor"]);
    assert.ok(doctor.warnings.some((w) => /over Codex's project_doc_max_bytes \(32768\)/.test(w)));
    await cli(dir, ["update", "--agents-md-limit", "96k"]);
    doctor = await cli(dir, ["doctor"]);
    assert.ok(!doctor.warnings.some((w) => /project_doc_max_bytes/.test(w)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("profiles/roles.json matches the profiles and marks one dynamic and one mechanical builder", async () => {
  const { rolesText, buildRoles } = await import("../tools/roles.mjs");
  const published = await readFile(path.join(ROOT, "profiles", "roles.json"), "utf8");
  assert.equal(published, rolesText(ROOT));
  const roles = buildRoles(ROOT);
  assert.deepEqual(Object.keys(roles.profiles), ["cheap", "cheap-100"]);
  for (const id of ["cheap", "cheap-100"]) {
    const builders = roles.profiles[id].filter((r) => r.builder);
    assert.deepEqual(builders.map((r) => r.builder).sort(), ["dynamic", "mechanical"]);
    for (const r of builders) assert.ok(r.model && r.effort && r.runAs);
  }
});

test("install and update stop before writing when cLoop is installed", async () => {
  const withState = await tempDir();
  const withBlock = await tempDir();
  const withHook = await tempDir();
  try {
    await mkdir(path.join(withState, ".cloop"), { recursive: true });
    await writeFile(path.join(withState, ".cloop", "state.json"), "{}\n");
    await assert.rejects(cli(withState, ["install", "--profile", "cheap"]), (err) => {
      assert.match(err.message, /cLoop is installed in this project/);
      assert.match(err.message, /--builders cheap/);
      assert.match(err.message, /install\.mjs uninstall --project \./);
      return true;
    });
    assert.equal(existsSync(path.join(withState, ".cheapgpt")), false);
    assert.equal(existsSync(path.join(withState, "AGENTS.md")) || existsSync(path.join(withState, "CLAUDE.md")), false);

    await writeFile(path.join(withBlock, "AGENTS.md"), "<!-- cloop:managed:start -->\nx\n<!-- cloop:managed:end -->\n");
    await assert.rejects(cli(withBlock, ["install", "--profile", "cheap-100"]), /cloop:managed block in AGENTS\.md[\s\S]*--builders cheap-100/);
    assert.equal(existsSync(path.join(withBlock, ".cheapgpt")), false);

    await cli(withHook, ["install", "--profile", "cheap"]);
    await mkdir(path.join(withHook, ".claude", "hooks"), { recursive: true });
    await writeFile(path.join(withHook, ".claude", "hooks", "cloop-turn.mjs"), "\n");
    await assert.rejects(cli(withHook, ["update"]), /cLoop is installed in this project/);
  } finally {
    for (const dir of [withState, withBlock, withHook]) await rm(dir, { recursive: true, force: true });
  }
});

test("install copies the flow tool, doctor checks it, update refreshes it, uninstall removes it", async () => {
  const dir = await tempDir();
  try {
    await cli(dir, ["install", "--profile", "cheap"]);
    const tool = path.join(dir, ".cheapgpt", "cheapgpt.mjs");
    const source = await readFile(path.join(ROOT, "cheapgpt.mjs"), "utf8");
    assert.equal(await readFile(tool, "utf8"), source);
    assert.equal((await cli(dir, ["doctor"])).ok, true);
    await writeFile(tool, "// stale\n");
    const stale = await cli(dir, ["doctor"]);
    assert.ok(stale.warnings.some((w) => /cheapgpt\.mjs does not match current sources/.test(w)));
    await rm(tool);
    assert.ok((await cli(dir, ["doctor"])).issues.some((i) => /missing \.cheapgpt\/cheapgpt\.mjs/.test(i)));
    await cli(dir, ["update"]);
    assert.equal(await readFile(tool, "utf8"), source);
    await cli(dir, ["uninstall"]);
    assert.equal(existsSync(tool), false);
    assert.equal(existsSync(path.join(dir, ".cheapgpt")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
