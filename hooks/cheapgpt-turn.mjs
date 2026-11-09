#!/usr/bin/env node
// CheapGPT turn hook — Claude Code edition (claude-edition and exp branches).
// UserPromptSubmit -> heartbeat (turn reminder). SessionStart(source=compact) -> short recovery reminder.
// Claude Code re-reads project-root CLAUDE.md after compaction, so the full block is never injected.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_FIELD = 10000; // Claude Code caps each injected field at 10,000 characters.

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

function promptId(event) {
  if (!event || typeof event !== "object") return "";
  const value = event.prompt_id ?? event.promptId ?? event.session_id ?? event.sessionId;
  return value == null ? "" : String(value);
}

function heartbeatContext(state, event) {
  const sha = String(state.managedBlockSha256 || "").slice(0, 16);
  const id = promptId(event) || "unknown";
  const file = state.instructionFile || "CLAUDE.md";
  const lines = [
    `CheapGPT heartbeat: the CheapGPT hook ran for prompt_id=${id}. Active profile=${state.profile}; preferred root=${state.root}; planner=${state.planner}; reviewer=${state.reviewer}; block sha=${sha}. The CheapGPT orchestration policy in ${file} applies to this turn; if it is not in context, re-read the managed block from ${file} before planning, delegation, or implementation. This heartbeat is direct evidence that the hook ran for this prompt.`,
    state.planningMode,
    "Default this turn: if the user started a new feature or debug and no durable plan exists, plan first (RAPID or FULL, no edits) unless they overrode; if a durable plan already exists for this task, implement under the assigned roles.",
  ];
  if (event && event.model) {
    lines.push(`Harness model: ${event.model}. Preferred profile root: ${state.root}. The harness model identity is authoritative and the profile root is advisory; continue with the current root and do not request substitute-root approval because the labels differ.`);
  }
  return lines.filter(Boolean).join("\n");
}

function recoveryContext(state) {
  const file = state.instructionFile || "CLAUDE.md";
  return [
    `CheapGPT recovery: SessionStart source=compact. The CheapGPT managed block in ${file} is authoritative; Claude Code reloads it after compaction, and if it is absent from context, re-read it from ${file} before planning, delegation, or implementation. Recover cheapgpt/plan.md if present.`,
    state.planningMode,
    "Default after recovery: if no durable plan exists for the current task, plan first (RAPID or FULL, no edits) unless the user overrode; otherwise continue implementation under the assigned roles.",
  ].filter(Boolean).join("\n\n");
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function failSafe(message) {
  emit({ continue: true, systemMessage: message });
}

function emitContext(hookEventName, additionalContext) {
  if (additionalContext.length > MAX_FIELD) {
    failSafe(`CheapGPT hook: ${hookEventName} context is ${additionalContext.length} chars, over the ${MAX_FIELD}-char limit; run \`node install.mjs doctor --project .\`.`);
    return;
  }
  emit({ continue: true, hookSpecificOutput: { hookEventName, additionalContext } });
}

async function main() {
  const event = await readStdin();
  if (event.parseError) {
    failSafe("CheapGPT hook: malformed hook stdin; continuing without injected context.");
    return;
  }
  const root = findProjectRoot(event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) {
    failSafe("CheapGPT hook: no .cheapgpt/state.json found from session cwd; CLAUDE.md policy remains authoritative.");
    return;
  }
  let state;
  try {
    state = JSON.parse(await readFile(path.join(root, ".cheapgpt", "state.json"), "utf8"));
  } catch {
    failSafe("CheapGPT hook: unreadable .cheapgpt/state.json; continuing without injected context.");
    return;
  }
  const eventName = event.hook_event_name || event.hookEventName || "";
  const source = event.source || "";
  if (eventName === "SessionStart") {
    if (source !== "compact") {
      emit({ continue: true });
      return;
    }
    emitContext("SessionStart", recoveryContext(state));
    return;
  }
  emitContext("UserPromptSubmit", heartbeatContext(state, event));
}

main().catch(() => {
  failSafe("CheapGPT hook: unexpected failure; continuing without injected context.");
});