#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const START_MARKER = "<!-- cheapgpt:managed:start -->";
const END_MARKER = "<!-- cheapgpt:managed:end -->";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: true };
  }
}

function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (existsSync(path.join(dir, ".cheapgpt", "state.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function extractManagedBlock(source) {
  if (typeof source !== "string") return null;
  const startCount = source.split(START_MARKER).length - 1;
  const endCount = source.split(END_MARKER).length - 1;
  if (startCount !== 1 || endCount !== 1) return null;
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (start < 0 || end < start) return null;
  return source.slice(start, end + END_MARKER.length);
}

function turnId(event) {
  if (!event || typeof event !== "object") return "";
  const value = event.turn_id ?? event.turnId;
  return value == null ? "" : String(value);
}

function heartbeatContext(state, event) {
  const sha = String(state.managedBlockSha256 || "").slice(0, 16);
  const model = event && event.model ? String(event.model) : "";
  const id = turnId(event) || "unknown";
  const lines = [
    `CHEAPGPT HEARTBEAT: hook executed for current turn_id=${id}. CHEAPGPT ACTIVE: profile=${state.profile} preferred_root="${state.root}" planner="${state.planner}" reviewer="${state.reviewer}" sha=${sha}. Apply the repository CheapGPT orchestration policy to this turn. If the current managed block is unavailable in active context, recover it from AGENTS.md before planning, delegation, or implementation. If asked whether the CheapGPT hook executed for this turn, this heartbeat is direct runtime evidence. Confirm it without falling back to "I cannot verify whether Codex ran the hook."`,
    state.planningMode,
    state.implementationMode,
    "Default this turn: if the user started a new feature or debug and no durable plan exists, stay in PLANNING MODE (plan-only, no edits) unless they overrode; if a durable plan already exists for this task, use IMPLEMENTATION MODE.",
  ];
  if (model) {
    lines.push(
      `Harness model slug: ${model}. Preferred profile root: ${state.root}. The harness/system model identity is authoritative; the profile root is advisory. Continue with the current root and do not request substitute-root approval solely because the labels differ.`
    );
  }
  return lines.filter(Boolean).join("\n");
}

function recoveryContext(state, block) {
  const parts = [
    "CHEAPGPT RECOVERY: SessionStart source=compact succeeded. Rehydrate and follow this exact managed CheapGPT policy before planning, delegation, or implementation.",
    block,
    state.planningMode,
    state.implementationMode,
    "Default after recovery: if no durable plan exists for the current task, use PLANNING MODE first (plan-only, no edits) unless the user overrode; otherwise continue IMPLEMENTATION MODE.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function emitContext(hookEventName, additionalContext) {
  emit({
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  });
}

function failSafe(message) {
  emit({
    continue: true,
    systemMessage: message,
  });
}

async function main() {
  const event = await readStdin();
  if (event.parseError) {
    failSafe("CheapGPT hook: malformed hook stdin; continuing without injected context.");
    return;
  }

  const root = findProjectRoot(event.cwd || process.cwd());
  if (!root) {
    failSafe("CheapGPT hook: no .cheapgpt/state.json found from session cwd; AGENTS.md policy remains authoritative.");
    return;
  }

  let state;
  try {
    state = JSON.parse(
      await readFile(path.join(root, ".cheapgpt", "state.json"), "utf8")
    );
  } catch {
    failSafe("CheapGPT hook: unreadable .cheapgpt/state.json; continuing without injected context.");
    return;
  }

  const eventName = event.hook_event_name || event.hookEventName || "";
  const source = event.source || event.session_source || "";

  if (eventName === "SessionStart" && source !== "compact") {
    emit({ continue: true });
    return;
  }

  if (eventName === "SessionStart" || source === "compact") {
    const instructionFile = path.join(root, state.instructionFile || "AGENTS.md");
    let block = null;
    try {
      block = extractManagedBlock(await readFile(instructionFile, "utf8"));
    } catch {
      block = null;
    }
    if (!block) {
      failSafe("CheapGPT recovery: managed AGENTS.md block missing or malformed; run `node install.mjs doctor --project .`.");
      return;
    }
    emitContext("SessionStart", recoveryContext(state, block));
    return;
  }

  emitContext("UserPromptSubmit", heartbeatContext(state, event));
}

main().catch(() => {
  failSafe("CheapGPT hook: unexpected failure; continuing without injected context.");
});
