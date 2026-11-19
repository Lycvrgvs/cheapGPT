// cheapGPT and cLoop are never installed together. install and update call refuseCloop() before
// writing anything; it stops when any cLoop artifact is present and prints the commands to choose one.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// catalog.harness -> [cheapGPT edition, matching cLoop edition]
export const EDITION_PAIRS = {
  codex: ["main", "codex"],
  "claude-exp": ["exp", "main"],
  claude: ["claude-edition", "claude"],
};

const CLOOP_MARKER = "cloop:managed";
const BUILDER_PROFILES = ["cheap", "cheap-100"];

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function imports(text) {
  const out = [];
  for (const match of String(text).matchAll(/(?:^|\s)@([^\s`'"]+)/gm)) out.push(match[1]);
  return out;
}

export async function detectCloop(projectRoot) {
  const found = [];
  const at = (rel) => path.join(projectRoot, rel);
  if (existsSync(at(".cloop/state.json"))) found.push(".cloop/state.json");
  for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
    const text = await readIfExists(at(rel));
    if (text == null) continue;
    if (text.includes(CLOOP_MARKER)) found.push(`a cloop:managed block in ${rel}`);
    for (const imported of imports(text)) {
      const file = path.resolve(projectRoot, imported);
      if (!file.startsWith(path.resolve(projectRoot) + path.sep)) continue;
      const body = await readIfExists(file);
      if (body != null && body.includes(CLOOP_MARKER)) found.push(`a cloop:managed block in ${imported} (imported by ${rel})`);
    }
  }
  for (const rel of [".codex/hooks.json", ".claude/settings.json"]) {
    const text = await readIfExists(at(rel));
    if (text != null && text.includes("cloop-turn.mjs")) found.push(`a cLoop hook in ${rel}`);
  }
  for (const rel of [".codex/hooks/cloop-turn.mjs", ".claude/hooks/cloop-turn.mjs"]) {
    if (existsSync(at(rel))) found.push(rel);
  }
  return found;
}

export function cloopMessage(found, harness, profileId) {
  const [, cloopEdition] = EDITION_PAIRS[harness || "codex"] || EDITION_PAIRS.codex;
  const lines = [
    `cLoop is installed in this project (found: ${found.join("; ")}). cheapGPT and cLoop are never installed together, so nothing was written. Ask the user which single package to keep:`,
  ];
  if (buildersOk(profileId)) {
    lines.push(`- Keep cLoop and use cheapGPT's ${profileId} builders (cLoop ${cloopEdition} edition): node /path/to/cLoop/install.mjs update --project . --builders ${profileId}`);
  } else {
    lines.push(`- Keep cLoop: cheapGPT builders exist only for the cheap and cheap-100 profiles (node /path/to/cLoop/install.mjs update --project . --builders cheap|cheap-100).`);
  }
  lines.push("- Keep cheapGPT alone: node /path/to/cLoop/install.mjs uninstall --project . , then rerun this command.");
  return lines.join("\n");
}

function buildersOk(profileId) {
  return BUILDER_PROFILES.includes(profileId);
}
