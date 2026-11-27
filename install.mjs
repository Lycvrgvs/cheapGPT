#!/usr/bin/env node
// CheapGPT installer: one repository, three editions. `--edition <name>` picks one. Without it, a project that
// already has CheapGPT keeps its installed edition, and a new project gets codex (what this command always installed).
//   node install.mjs install --project . --profile cheap [--edition codex|claude|exp]
// Each edition's installer is in editions/<installer>/install.mjs and its profiles in editions/<edition>/profiles/.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EDITIONS = {
  codex: { installer: "codex", harness: "Codex: root and every role in Codex" },
  claude: { installer: "claude", harness: "Claude Code: root and every role in Claude Code" },
  exp: { installer: "claude", harness: "Claude Code root and reviewers; builders through the Codex CLI" },
};
export const DEFAULT_EDITION = "codex";

// The edition a project has, read from its install state: Codex writes AGENTS.md; of the two Claude Code editions,
// only exp records the permission for `codex exec`.
export function installedEdition(projectRoot) {
  const file = path.join(projectRoot, ".cheapgpt", "state.json");
  if (!existsSync(file)) return null;
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (state.instructionFile === "AGENTS.md") return "codex";
  return state.codexPermission ? "exp" : "claude";
}

// Splits --edition out of argv and settles the edition: the one asked for, else the installed one, else the default.
export function chooseEdition(argv) {
  const rest = [];
  let asked = null, project = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--edition") { asked = argv[i + 1]; i += 1; continue; }
    if (token.startsWith("--edition=")) { asked = token.slice(10); continue; }
    if (token === "--project" && argv[i + 1]) project = path.resolve(argv[i + 1]);
    else if (token.startsWith("--project=")) project = path.resolve(token.slice(10));
    rest.push(token);
  }
  if (asked !== null && !EDITIONS[asked]) throw new Error(`unknown edition '${asked}'; the editions are ${Object.keys(EDITIONS).join(", ")}`);
  const installed = installedEdition(project);
  if (asked && installed && asked !== installed) {
    throw new Error(`this project has the ${installed} edition installed; to change it, run uninstall first, then install --edition ${asked}`);
  }
  return { edition: asked || installed || DEFAULT_EDITION, argv: rest };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(path.resolve(entry)).href; } catch { return false; }
}

if (isDirectRun()) {
  let picked;
  try { picked = chooseEdition(process.argv); } catch (err) {
    process.stderr.write(`cheapgpt: ${err.message}\n`);
    process.exit(1);
  }
  const { edition, argv } = picked;
  const installer = await import(pathToFileURL(path.join(HERE, "editions", EDITIONS[edition].installer, "install.mjs")).href);
  await installer.cli(argv, { sourceRoot: path.join(HERE, "editions", edition) });
}
