#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACKAGE_VERSION = "1.3.0";
export const SCHEMA_VERSION = 1;
export const START_MARKER = "<!-- cheapgpt:managed:start -->";
export const END_MARKER = "<!-- cheapgpt:managed:end -->";
export const HOOK_TAG = "cheapgpt:";
export const HOOK_SCRIPT_NAME = "cheapgpt-turn.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_ALIASES = {
  ultracheap: "ultracheap",
  ultra: "ultracheap",
  cheap: "cheap",
  "cheap-5x": "cheap-5x",
  cheap5x: "cheap-5x",
  "5x": "cheap-5x",
  "cheap-20x": "cheap-20x",
  cheap20x: "cheap-20x",
  "20x": "cheap-20x",
  "cheap-25x": "cheap-20x",
  cheap25x: "cheap-20x",
  "25x": "cheap-20x",
};

export class CheapgptError extends Error {
  constructor(message, code = "CHEAPGPT") {
    super(message);
    this.code = code;
  }
}

export function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function resolveProfileId(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  return PROFILE_ALIASES[key] || null;
}

export async function loadCatalog(sourceRoot = HERE) {
  const catalogPath = path.join(sourceRoot, "profiles", "catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!catalog || !catalog.profiles) {
    throw new CheapgptError("profiles/catalog.json is missing profiles", "CATALOG");
  }
  return catalog;
}

export async function loadProfile(profileId, sourceRoot = HERE) {
  const catalog = await loadCatalog(sourceRoot);
  const meta = catalog.profiles[profileId];
  if (!meta) {
    throw new CheapgptError(
      `Unknown profile '${profileId}'. Use ultracheap, cheap, cheap-5x, or cheap-20x.`,
      "PROFILE"
    );
  }
  const filePath = path.join(sourceRoot, "profiles", meta.file);
  const body = await readFile(filePath, "utf8");
  return {
    id: profileId,
    meta,
    body,
    sha256: sha256(body),
    path: filePath,
  };
}

export function buildManagedBlock(profileId, profileBody) {
  const body = String(profileBody).replace(/\s+$/, "");
  return [
    START_MARKER,
    "## CheapGPT Orchestration Policy",
    "",
    `Active profile: \`${profileId}\``,
    "",
    "This CheapGPT policy applies to every user turn in this repository. Treat the active profile below as persistent orchestration policy for planning, implementation, testing, review, debugging, and completion. Do not silently substitute the profile's explicitly requested Astra planner/reviewer model or reasoning effort. A preferred root configuration is advisory and must not block the already-running harness/system root. If the policy appears unavailable after context compaction or another harness transition, recover the current managed CheapGPT block before delegating or implementing.",
    "",
    body,
    "",
    END_MARKER,
    "",
  ].join("\n");
}

export function extractManagedRegion(source) {
  const text = source == null ? "" : String(source);
  const starts = [];
  const ends = [];
  for (let i = 0; i < text.length; ) {
    const found = text.indexOf(START_MARKER, i);
    if (found < 0) break;
    starts.push(found);
    i = found + START_MARKER.length;
  }
  for (let i = 0; i < text.length; ) {
    const found = text.indexOf(END_MARKER, i);
    if (found < 0) break;
    ends.push(found);
    i = found + END_MARKER.length;
  }
  if (starts.length === 0 && ends.length === 0) {
    return { kind: "absent", source: text };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      kind: "malformed",
      reason:
        starts.length !== 1
          ? `expected exactly one start marker, found ${starts.length}`
          : `expected exactly one end marker, found ${ends.length}`,
      source: text,
    };
  }
  if (ends[0] < starts[0]) {
    return {
      kind: "malformed",
      reason: "end marker precedes start marker",
      source: text,
    };
  }
  let end = ends[0] + END_MARKER.length;
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return {
    kind: "ok",
    start: starts[0],
    end,
    block: text.slice(starts[0], end),
    source: text,
  };
}

export function extractProfileFromBlock(block, profileId) {
  const region = extractManagedRegion(block);
  if (region.kind !== "ok") return null;
  const inner = region.block
    .replace(START_MARKER, "")
    .replace(END_MARKER, "");
  const needle = "recover the current managed CheapGPT block before delegating or implementing.";
  const idx = inner.indexOf(needle);
  if (idx < 0) return inner.trim();
  return inner.slice(idx + needle.length).trim();
}

export function applyManagedBlock(source, block) {
  const region = extractManagedRegion(source);
  if (region.kind === "malformed") {
    throw new CheapgptError(
      `AGENTS.md CheapGPT markers are malformed (${region.reason}). Refusing to guess. Fix or restore the file, then rerun.`,
      "MARKERS"
    );
  }
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;
  if (region.kind === "absent") {
    const preserved = String(source || "").replace(/\s+$/, "");
    return preserved ? `${preserved}\n\n${normalizedBlock}` : normalizedBlock;
  }
  const before = region.source.slice(0, region.start).replace(/\s+$/, "");
  const after = region.source.slice(region.end).replace(/^\s+/, "").replace(/\s+$/, "");
  const parts = [];
  if (before) parts.push(before);
  parts.push(normalizedBlock.replace(/\n+$/, ""));
  if (after) parts.push(after);
  return `${parts.join("\n\n")}\n`;
}

export function removeManagedBlock(source) {
  const region = extractManagedRegion(source);
  if (region.kind === "malformed") {
    throw new CheapgptError(
      `AGENTS.md CheapGPT markers are malformed (${region.reason}). Refusing to uninstall.`,
      "MARKERS"
    );
  }
  if (region.kind === "absent") return String(source || "");
  const before = region.source.slice(0, region.start).replace(/\s+$/, "");
  const after = region.source.slice(region.end).replace(/^\s+/, "").replace(/\s+$/, "");
  if (!before && !after) return "";
  if (before && after) return `${before}\n\n${after}\n`;
  return `${before || after}\n`;
}

function projectPaths(projectRoot) {
  return {
    root: projectRoot,
    agents: path.join(projectRoot, "AGENTS.md"),
    stateDir: path.join(projectRoot, ".cheapgpt"),
    state: path.join(projectRoot, ".cheapgpt", "state.json"),
    codexDir: path.join(projectRoot, ".codex"),
    hooksDir: path.join(projectRoot, ".codex", "hooks"),
    hooksJson: path.join(projectRoot, ".codex", "hooks.json"),
    hookScript: path.join(projectRoot, ".codex", "hooks", HOOK_SCRIPT_NAME),
  };
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(tmp, contents, "utf8");
  try {
    await rename(tmp, filePath);
  } catch {
    await rm(filePath, { force: true });
    await rename(tmp, filePath);
  }
}

function posixHookCommand() {
  return `node "$(git rev-parse --show-toplevel)/.codex/hooks/${HOOK_SCRIPT_NAME}"`;
}

function windowsHookCommand() {
  return `powershell -NoProfile -Command "node (Join-Path (git rev-parse --show-toplevel) '.codex/hooks/${HOOK_SCRIPT_NAME}')"`;
}

function isCheapgptHookHandler(handler) {
  if (!handler || typeof handler !== "object") return false;
  const command = `${handler.command || ""} ${handler.commandWindows || ""} ${handler.statusMessage || ""}`;
  return command.includes(HOOK_SCRIPT_NAME) || command.includes(HOOK_TAG);
}

function cheapgptHookHandler(kind) {
  return {
    type: "command",
    command: posixHookCommand(),
    commandWindows: windowsHookCommand(),
    statusMessage: `${HOOK_TAG}${kind}`,
    timeout: 15,
    ...(kind === "recovery" ? { additionalContextLimit: 8000 } : {}),
  };
}

export function mergeCheapgptHooks(existingJson, enabled) {
  let parsed;
  if (existingJson == null || existingJson.trim() === "") {
    parsed = { hooks: {} };
  } else {
    try {
      parsed = JSON.parse(existingJson);
    } catch {
      throw new CheapgptError(
        "Existing .codex/hooks.json is not valid JSON. Refusing to rewrite unrelated hooks.",
        "HOOKS"
      );
    }
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CheapgptError("Existing .codex/hooks.json is not an object.", "HOOKS");
  }
  if (!parsed.hooks || typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks)) {
    parsed.hooks = {};
  }

  const strip = (eventName) => {
    const groups = parsed.hooks[eventName];
    if (!Array.isArray(groups)) return;
    const kept = [];
    for (const group of groups) {
      if (!group || typeof group !== "object") {
        throw new CheapgptError(
          `Refusing to rewrite malformed ${eventName} hook group.`,
          "HOOKS"
        );
      }
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      const remaining = handlers.filter((handler) => !isCheapgptHookHandler(handler));
      const removedCheapgpt = remaining.length !== handlers.length;
      if (!removedCheapgpt) {
        kept.push(group);
        continue;
      }
      if (remaining.length > 0) {
        kept.push({ ...group, hooks: remaining });
      }
    }
    if (kept.length) parsed.hooks[eventName] = kept;
    else delete parsed.hooks[eventName];
  };

  strip("UserPromptSubmit");
  strip("SessionStart");

  if (enabled) {
    const promptGroups = Array.isArray(parsed.hooks.UserPromptSubmit)
      ? parsed.hooks.UserPromptSubmit
      : [];
    promptGroups.push({
      hooks: [cheapgptHookHandler("heartbeat")],
    });
    parsed.hooks.UserPromptSubmit = promptGroups;

    const startGroups = Array.isArray(parsed.hooks.SessionStart)
      ? parsed.hooks.SessionStart
      : [];
    startGroups.push({
      matcher: "^compact$",
      hooks: [cheapgptHookHandler("recovery")],
    });
    parsed.hooks.SessionStart = startGroups;
  }

  if (!parsed.description) {
    parsed.description = "Project-local Codex hooks.";
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function cheapgptHookCount(hooksJson) {
  if (!hooksJson) return { heartbeat: 0, recovery: 0 };
  let parsed;
  try {
    parsed = JSON.parse(hooksJson);
  } catch {
    return { heartbeat: 0, recovery: 0, malformed: true };
  }
  const count = (eventName, kind) => {
    const groups = parsed?.hooks?.[eventName];
    if (!Array.isArray(groups)) return 0;
    let n = 0;
    for (const group of groups) {
      for (const handler of group?.hooks || []) {
        if (isCheapgptHookHandler(handler) && String(handler.statusMessage || "").includes(kind)) {
          n += 1;
        }
      }
    }
    return n;
  };
  return {
    heartbeat: count("UserPromptSubmit", "heartbeat"),
    recovery: count("SessionStart", "recovery"),
  };
}

function snapshotFile(filePath, contents) {
  return { filePath, existed: contents != null, contents };
}

async function restoreSnapshots(snapshots) {
  for (const snap of snapshots) {
    if (!snap.existed) {
      await rm(snap.filePath, { force: true });
    } else {
      await atomicWrite(snap.filePath, snap.contents);
    }
  }
}

async function maybeFail(stage) {
  if (process.env.CHEAPGPT_FAIL_AFTER === stage) {
    throw new CheapgptError(`induced failure after ${stage}`, "INDUCED");
  }
}

function buildState({
  profile,
  managedBlock,
  hookMode,
  created,
  previous,
}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    profile: profile.id,
    root: profile.meta.root,
    planner: profile.meta.planner,
    reviewer: profile.meta.reviewer,
    planningMode: profile.meta.planningMode,
    implementationMode: profile.meta.implementationMode,
    installedAt: previous?.installedAt || now,
    updatedAt: now,
    instructionFile: "AGENTS.md",
    managedBlockSha256: sha256(managedBlock),
    profileSha256: profile.sha256,
    hookMode,
    hookFiles: hookMode === "codex" ? [`.codex/hooks/${HOOK_SCRIPT_NAME}`] : [],
    created: {
      agents: Boolean(created?.agents),
      hooksJson: Boolean(created?.hooksJson),
      hookScript: Boolean(created?.hookScript),
      stateDir: Boolean(created?.stateDir),
      codexDir: Boolean(created?.codexDir),
    },
  };
}

async function readState(paths) {
  const raw = await readTextIfExists(paths.state);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new CheapgptError(
      ".cheapgpt/state.json exists but is not valid JSON. Use --force only after reviewing the file.",
      "STATE"
    );
  }
}

function managedBlockModified(state, currentBlock) {
  if (!state || !currentBlock) return false;
  return sha256(currentBlock) !== state.managedBlockSha256;
}

export function parseArgs(argv) {
  const args = {
    command: null,
    project: process.cwd(),
    profile: null,
    dryRun: false,
    force: false,
    json: false,
    hooks: true,
    hooksExplicit: false,
    help: false,
  };
  const rest = argv.slice(2);
  if (rest.length === 0 || rest[0] === "-h" || rest[0] === "--help") {
    args.command = "help";
    args.help = true;
    return args;
  }
  const first = rest[0];
  if (first.startsWith("-")) {
    throw new CheapgptError(
      "Missing command. Use install, update, doctor, or uninstall.",
      "USAGE"
    );
  }
  args.command = first;
  for (let i = 1; i < rest.length; i += 1) {
    const token = rest[i];
    const next = () => {
      const value = rest[i + 1];
      if (value == null || value.startsWith("-")) {
        throw new CheapgptError(`Missing value for ${token}`, "USAGE");
      }
      i += 1;
      return value;
    };
    if (token === "--project") args.project = path.resolve(next());
    else if (token.startsWith("--project=")) args.project = path.resolve(token.slice(10));
    else if (token === "--profile") args.profile = next();
    else if (token.startsWith("--profile=")) args.profile = token.slice(10);
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--force") args.force = true;
    else if (token === "--json") args.json = true;
    else if (token === "--hooks" || token === "--turn-reminder") {
      args.hooks = true;
      args.hooksExplicit = true;
    } else if (token === "--no-hooks" || token === "--no-turn-reminder") {
      args.hooks = false;
      args.hooksExplicit = true;
    }
    else if (token === "--global") {
      throw new CheapgptError(
        "CheapGPT refuses --global. It is project-local only and writes that project's AGENTS.md, never ~/.codex.",
        "USAGE"
      );
    } else if (token === "-h" || token === "--help") {
      args.help = true;
      args.command = "help";
    } else {
      throw new CheapgptError(`Unknown option ${token}`, "USAGE");
    }
  }
  return args;
}

export function helpText() {
  return `CheapGPT — project-local Codex orchestration installer

CheapGPT never installs globally. It only mutates the target --project directory:
  AGENTS.md
  .cheapgpt/state.json
  .codex/hooks.json
  .codex/hooks/cheapgpt-turn.mjs

Every repository needs its own install. Installing in one project does not affect others.

Usage:
  node install.mjs install --project . --profile <id>
  node install.mjs update --project . [--profile <id>]
  node install.mjs doctor --project .
  node install.mjs uninstall --project .

Profiles:
  ultracheap   ChatGPT Plus, simple tasks     root=Luna xHigh
  cheap        ChatGPT Plus, medium-hard      root=Luna Max
  cheap-5x     ChatGPT Pro 5x, hardest        root=Sol-high
  cheap-20x    ChatGPT Pro 20x, hardest       root=gpt-5.6-sol xhigh

Options:
  --project <dir>     Target repository (default: cwd)
  --profile <id>      Required for install; optional for update
  --dry-run           Validate and report without writing
  --force             Overwrite a manually edited CheapGPT block
  --json              Machine-readable output
  --no-hooks          Skip Codex heartbeat/recovery hooks
  --hooks             Install hooks (default)

Do not copy-paste profile text into AGENTS.md. Always run this script.
`;
}

async function inspectProject(paths) {
  const agents = await readTextIfExists(paths.agents);
  const state = await readState(paths);
  const hooksJson = await readTextIfExists(paths.hooksJson);
  const region = extractManagedRegion(agents || "");
  return {
    agents,
    state,
    hooksJson,
    region,
    hasAgents: agents != null,
    hasState: state != null,
    hasHooksJson: hooksJson != null,
    hasCodexDir: existsSync(paths.codexDir),
    hasStateDir: existsSync(paths.stateDir),
    hasHookScript: existsSync(paths.hookScript),
  };
}

function requireUnmodified(inspect, force, action) {
  if (inspect.region.kind === "malformed") {
    throw new CheapgptError(
      `AGENTS.md CheapGPT markers are malformed (${inspect.region.reason}). ${action} refused.`,
      "MARKERS"
    );
  }
  if (
    inspect.state &&
    inspect.region.kind === "ok" &&
    managedBlockModified(inspect.state, inspect.region.block) &&
    !force
  ) {
    throw new CheapgptError(
      `CheapGPT managed block in AGENTS.md was modified by hand. ${action} refused. Review the block, then rerun with --force.`,
      "MODIFIED"
    );
  }
}

async function writeInstallation({
  paths,
  inspect,
  profile,
  hookMode,
  dryRun,
}) {
  const managedBlock = buildManagedBlock(profile.id, profile.body);
  const nextAgents = applyManagedBlock(inspect.agents || "", managedBlock);
  const created = {
    agents: !inspect.hasAgents,
    hooksJson: hookMode === "codex" && !inspect.hasHooksJson,
    hookScript: hookMode === "codex" && !inspect.hasHookScript,
    stateDir: !inspect.hasStateDir,
    codexDir: hookMode === "codex" && !inspect.hasCodexDir,
  };
  const nextState = buildState({
    profile,
    managedBlock,
    hookMode,
    created: {
      agents: inspect.state?.created?.agents || created.agents,
      hooksJson: hookMode === "codex" && (inspect.state?.created?.hooksJson || created.hooksJson),
      hookScript: hookMode === "codex" && (inspect.state?.created?.hookScript || created.hookScript),
      stateDir: inspect.state?.created?.stateDir || created.stateDir,
      codexDir: hookMode === "codex" && (inspect.state?.created?.codexDir || created.codexDir),
    },
    previous: inspect.state,
  });
  const nextHooksJson =
    hookMode === "codex"
      ? mergeCheapgptHooks(inspect.hooksJson, true)
      : inspect.hasHooksJson
        ? mergeCheapgptHooks(inspect.hooksJson, false)
        : null;
  const hookSource = path.join(HERE, "hooks", HOOK_SCRIPT_NAME);

  const planned = {
    profile: profile.id,
    instructionFile: "AGENTS.md",
    hookMode,
    managedBlockSha256: nextState.managedBlockSha256,
    writes: ["AGENTS.md", ".cheapgpt/state.json"],
  };
  if (hookMode === "codex") {
    planned.writes.push(".codex/hooks.json", `.codex/hooks/${HOOK_SCRIPT_NAME}`);
  } else if (inspect.hasHooksJson || inspect.hasHookScript) {
    planned.writes.push(".codex/hooks.json");
    if (inspect.hasHookScript) planned.removes = [`.codex/hooks/${HOOK_SCRIPT_NAME}`];
  }

  if (dryRun) {
    return { dryRun: true, ...planned };
  }

  const snapshots = [
    snapshotFile(paths.agents, inspect.agents),
    snapshotFile(paths.state, inspect.hasState ? JSON.stringify(inspect.state, null, 2) + "\n" : null),
    snapshotFile(paths.hooksJson, inspect.hooksJson),
    snapshotFile(
      paths.hookScript,
      inspect.hasHookScript ? await readTextIfExists(paths.hookScript) : null
    ),
  ];

  try {
    await atomicWrite(paths.agents, nextAgents);
    await maybeFail("agents");
    if (hookMode === "codex") {
      await mkdir(paths.hooksDir, { recursive: true });
      await copyFile(hookSource, paths.hookScript);
      await maybeFail("hooks");
      await atomicWrite(paths.hooksJson, nextHooksJson);
    } else {
      if (inspect.hasHooksJson && nextHooksJson != null) {
        await atomicWrite(paths.hooksJson, nextHooksJson);
      }
      if (inspect.hasHookScript) {
        await rm(paths.hookScript, { force: true });
      }
    }
    await maybeFail("state");
    await atomicWrite(paths.state, `${JSON.stringify(nextState, null, 2)}\n`);
  } catch (err) {
    await restoreSnapshots(snapshots);
    throw err;
  }

  return { dryRun: false, ...planned, state: nextState };
}

async function cmdInstall(args, sourceRoot = HERE) {
  const profileId = resolveProfileId(args.profile);
  if (!profileId) {
    throw new CheapgptError(
      "install requires --profile ultracheap|cheap|cheap-5x|cheap-20x",
      "USAGE"
    );
  }
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  requireUnmodified(inspect, args.force, "install");
  const profile = await loadProfile(profileId, sourceRoot);
  const hookMode = args.hooks ? "codex" : "none";
  return writeInstallation({
    paths,
    inspect,
    profile,
    hookMode,
    dryRun: args.dryRun,
  });
}

async function cmdUpdate(args, sourceRoot = HERE) {
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  if (!inspect.state && inspect.region.kind === "absent") {
    throw new CheapgptError(
      "No CheapGPT installation found. Run install --profile <id> first.",
      "MISSING"
    );
  }
  requireUnmodified(inspect, args.force, "update");
  const profileId = resolveProfileId(args.profile) || inspect.state?.profile;
  if (!resolveProfileId(profileId)) {
    throw new CheapgptError(
      "update needs --profile because existing state has no recognized profile.",
      "USAGE"
    );
  }
  const profile = await loadProfile(resolveProfileId(profileId), sourceRoot);
  let hookMode = inspect.state?.hookMode === "none" ? "none" : "codex";
  if (args.hooksExplicit) hookMode = args.hooks ? "codex" : "none";
  return writeInstallation({
    paths,
    inspect,
    profile,
    hookMode,
    dryRun: args.dryRun,
  });
}

async function cmdUninstall(args) {
  const paths = projectPaths(args.project);
  const inspect = await inspectProject(paths);
  if (!inspect.state && inspect.region.kind === "absent" && !inspect.hasHookScript) {
    throw new CheapgptError("No CheapGPT installation found.", "MISSING");
  }
  requireUnmodified(inspect, args.force, "uninstall");

  const nextAgents =
    inspect.agents == null ? null : removeManagedBlock(inspect.agents);
  const nextHooksJson = inspect.hasHooksJson
    ? mergeCheapgptHooks(inspect.hooksJson, false)
    : null;

  const planned = {
    removes: [".cheapgpt/state.json"],
    writes: [],
  };
  if (inspect.hasAgents) planned.writes.push("AGENTS.md");
  if (inspect.hasHookScript) planned.removes.push(`.codex/hooks/${HOOK_SCRIPT_NAME}`);
  if (inspect.hasHooksJson) planned.writes.push(".codex/hooks.json");

  if (args.dryRun) {
    return { dryRun: true, action: "uninstall", ...planned };
  }

  const snapshots = [
    snapshotFile(paths.agents, inspect.agents),
    snapshotFile(paths.state, inspect.hasState ? JSON.stringify(inspect.state, null, 2) + "\n" : null),
    snapshotFile(paths.hooksJson, inspect.hooksJson),
    snapshotFile(
      paths.hookScript,
      inspect.hasHookScript ? await readTextIfExists(paths.hookScript) : null
    ),
  ];

  try {
    if (nextAgents == null || nextAgents.trim() === "") {
      if (inspect.hasAgents) await rm(paths.agents, { force: true });
    } else {
      await atomicWrite(paths.agents, nextAgents);
    }
    await maybeFail("agents");
    if (inspect.hasHookScript) await rm(paths.hookScript, { force: true });
    if (nextHooksJson != null) {
      const parsed = JSON.parse(nextHooksJson);
      const empty =
        parsed.hooks &&
        Object.keys(parsed.hooks).length === 0 &&
        inspect.state?.created?.hooksJson;
      if (empty) await rm(paths.hooksJson, { force: true });
      else await atomicWrite(paths.hooksJson, nextHooksJson);
    }
    await maybeFail("state");
    await rm(paths.state, { force: true });
    if (existsSync(paths.stateDir)) {
      try {
        await rm(paths.stateDir, { recursive: true });
      } catch {
        /* keep dir if not empty */
      }
    }
  } catch (err) {
    await restoreSnapshots(snapshots);
    throw err;
  }

  return { dryRun: false, action: "uninstall", ...planned };
}

export async function doctorProject(projectRoot, sourceRoot = HERE) {
  const paths = projectPaths(projectRoot);
  const inspect = await inspectProject(paths);
  const issues = [];
  const warnings = [];

  if (!inspect.hasState) issues.push("missing .cheapgpt/state.json");
  let state = inspect.state;
  if (state) {
    if (state.schemaVersion !== SCHEMA_VERSION) {
      issues.push(`state schemaVersion ${state.schemaVersion} != ${SCHEMA_VERSION}`);
    }
    if (state.packageVersion && state.packageVersion !== PACKAGE_VERSION) {
      warnings.push(
        `installed packageVersion ${state.packageVersion} != ${PACKAGE_VERSION}; run update`
      );
    }
    if (!resolveProfileId(state.profile)) issues.push(`unrecognized profile '${state.profile}'`);
    if (state.instructionFile !== "AGENTS.md") {
      issues.push(`instructionFile ${state.instructionFile} is not AGENTS.md`);
    }
  }
  if (!inspect.hasAgents) issues.push("missing AGENTS.md");
  if (inspect.region.kind === "absent") issues.push("no CheapGPT managed block in AGENTS.md");
  if (inspect.region.kind === "malformed") issues.push(`malformed markers: ${inspect.region.reason}`);
  if (inspect.region.kind === "ok" && state) {
    if (managedBlockModified(state, inspect.region.block)) {
      issues.push("managed block hash does not match state.json");
    }
    const expectedProfile = state.profile && resolveProfileId(state.profile);
    if (expectedProfile) {
      try {
        const profile = await loadProfile(expectedProfile, sourceRoot);
        const expected = buildManagedBlock(profile.id, profile.body);
        if (inspect.region.block.replace(/\s+$/, "") !== expected.replace(/\s+$/, "")) {
          warnings.push("installed block does not match current CheapGPT profile sources; run update");
        }
      } catch {
        warnings.push("could not load current profile sources for comparison");
      }
    }
  }

  const hookCounts = cheapgptHookCount(inspect.hooksJson);
  if (state?.hookMode === "codex") {
    if (!inspect.hasHookScript) issues.push("missing .codex/hooks/cheapgpt-turn.mjs");
    if (hookCounts.malformed) issues.push(".codex/hooks.json is malformed");
    if (hookCounts.heartbeat !== 1) {
      issues.push(`expected exactly one CheapGPT UserPromptSubmit heartbeat hook, found ${hookCounts.heartbeat}`);
    }
    if (hookCounts.recovery !== 1) {
      issues.push(`expected exactly one CheapGPT SessionStart compact recovery hook, found ${hookCounts.recovery}`);
    }
    try {
      const expectedHook = await readFile(path.join(sourceRoot, "hooks", HOOK_SCRIPT_NAME), "utf8");
      const installedHook = await readTextIfExists(paths.hookScript);
      if (installedHook != null && sha256(installedHook) !== sha256(expectedHook)) {
        warnings.push("installed CheapGPT hook script does not match current sources; run update");
      }
    } catch {
      warnings.push("could not compare CheapGPT hook script to current sources");
    }
    warnings.push(
      "project-local Codex hooks run only for trusted projects; AGENTS.md remains authoritative if hooks are skipped"
    );
  } else if (state?.hookMode === "none") {
    if (hookCounts.heartbeat || hookCounts.recovery) {
      issues.push("hookMode is none but CheapGPT hook entries still exist");
    }
  }

  return {
    ok: issues.length === 0,
    project: projectRoot,
    profile: state?.profile || null,
    hookMode: state?.hookMode || null,
    issues,
    warnings,
  };
}

async function cmdDoctor(args, sourceRoot = HERE) {
  return doctorProject(args.project, sourceRoot);
}

export async function run(argv, options = {}) {
  const sourceRoot = options.sourceRoot || HERE;
  const args = parseArgs(argv);
  args.project = path.resolve(args.project);
  if (args.help || args.command === "help") {
    return { ok: true, help: helpText() };
  }
  const commands = {
    install: cmdInstall,
    update: cmdUpdate,
    uninstall: cmdUninstall,
    doctor: cmdDoctor,
  };
  const fn = commands[args.command];
  if (!fn) {
    throw new CheapgptError(
      `Unknown command '${args.command}'. Use install, update, doctor, or uninstall.`,
      "USAGE"
    );
  }
  const result = await fn(args, sourceRoot);
  return { ok: true, command: args.command, ...result };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

async function main() {
  try {
    const result = await run(process.argv);
    if (result.help) {
      process.stdout.write(result.help);
      return;
    }
    const jsonMode = process.argv.includes("--json");
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.command === "doctor") {
      if (result.ok) process.stdout.write("CheapGPT doctor: ok\n");
      else process.stdout.write("CheapGPT doctor: FAILED\n");
      if (result.profile) process.stdout.write(`profile: ${result.profile}\n`);
      if (result.hookMode) process.stdout.write(`hookMode: ${result.hookMode}\n`);
      for (const issue of result.issues || []) process.stdout.write(`issue: ${issue}\n`);
      for (const warning of result.warnings || []) process.stdout.write(`warning: ${warning}\n`);
      if (!result.ok) process.exitCode = 1;
    } else if (result.dryRun) {
      process.stdout.write(`CheapGPT ${result.command || "plan"} dry-run: no files written\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`CheapGPT ${result.command} complete (${result.profile || result.action || "ok"})\n`);
      if (result.hookMode === "codex") {
        process.stdout.write(
          "Hooks installed. Trust this project in Codex and re-review /hooks so heartbeat and compact recovery can run. Hook trust is tied to the current hook definition; an update that changes cheapgpt-turn.mjs requires review again.\n"
        );
      }
    }
    if (result.command === "doctor" && result.ok === false) process.exitCode = 1;
  } catch (err) {
    const jsonMode = process.argv.includes("--json");
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: err.message, code: err.code || "CHEAPGPT" }, null, 2)}\n`
      );
    } else {
      process.stderr.write(`cheapgpt: ${err.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}
