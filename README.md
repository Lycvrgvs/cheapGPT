# CheapGPT — Claude Code edition

CheapGPT installs a **project-local** Claude Code orchestration policy into a repository's root `CLAUDE.md`. The goal is the fewest expensive tokens per correct change. The Opus root plans, decides, integrates and verifies. A dynamic implementer (Sonnet) takes every task that needs judgment, and a mechanical implementer (Haiku) takes every task the handoff fully determines. Fresh Opus reviewers check the plan and the build twice each: once when the core is done and again when it is complete. When a review fails, a fresh loop-breaker takes over a new cycle instead of letting work spiral. This branch is the Claude Code edition; `main` is the Codex edition.

It is **not** a global install. It never writes `~/.claude` and only mutates the target project folder you pass as `--project`. Every repository that should use CheapGPT needs its own install. Do not copy-paste profile text by hand; always run `install.mjs` so markers, hashes, and uninstall keep working.

## Install / update / doctor / uninstall

Requires Node 18+ and a checkout of this branch (so `profiles/` and `hooks/` sit beside `install.mjs`).

```bash
node /path/to/cheapGPT/install.mjs install --project . --profile cheap
node /path/to/cheapGPT/install.mjs update --project .
node /path/to/cheapGPT/install.mjs doctor --project .
node /path/to/cheapGPT/install.mjs uninstall --project .
```

Flags: `--dry-run`, `--force` (overwrite a hand-edited CheapGPT block), `--json`, `--no-hooks`, `--hooks` (default). `--global` is rejected.

After install, open the project in Claude Code, accept the workspace trust dialog, and review `/hooks`. The committed `.claude/` config works in the CLI, desktop, and web sessions.

## What it writes

```text
CLAUDE.md                          # bounded CheapGPT block appended or replaced
.cheapgpt/state.json               # profile, hashes, hook mode
.claude/settings.json              # CheapGPT hook entries merged into "hooks"; other keys kept
.claude/hooks/cheapgpt-turn.mjs    # heartbeat (UserPromptSubmit) + short compact reminder (SessionStart: compact)
```

Claude Code re-reads the project-root `CLAUDE.md` after compaction, so the compact hook injects only the turn reminder, never the whole block. While a task runs, the root also keeps `cheapgpt/plan.md` (the board) and `temporary/` (scratch files). Both are git-excluded and deleted when the task passes.

## Profiles

Install **exactly one**.

| Profile | Use when | Root | Dynamic | Mechanical | Reviewers | Loop-breaker | Board |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| `cheap` | medium-hard tasks | opus-5.5-medium | Sonnet 5.5 medium | Haiku 5.5 xhigh | Opus 5.5 medium | Opus 5.5 xhigh | 20,000 |
| `cheap-100` | hardest tasks | opus-5.5-high | Sonnet 5.5 xhigh | Haiku 5.5 xhigh | Opus 5.5 high | Fable 5.1 xhigh | 25,000 |

There is no `ultracheap` on this branch; it remains a legacy Codex profile on `main`.

Every subagent is spawned with Claude Code's native `Agent` tool and an explicit `model` and `effort`. A fork would run on the root's model, so implementers can't inherit the root conversation. Instead, each implementer gets a conversation packet with its first assignment and is continued through `SendMessage`. Reviewers and loop-breakers are always new subagents.

The flow is the same as on `main`:
- route (DIRECT / FOCUSED / FULL);
- PLAN and BUILD, each with a core review and a terminal review;
- a failed repair is reverted and the root goes back to PLAN;
- loop-breaker cycles, one step back, then BLOCKED with EXPLORE/RESEARCH options;
- an issue draft only after a hard task finally passes.

## Tests

```bash
node --test test/installer.test.mjs
```

## Layout

```text
install.mjs              zero-dependency installer
profiles/*.md            canonical profile policies (Claude Code edition)
profiles/catalog.json    profile metadata and turn reminders
hooks/cheapgpt-turn.mjs  copied into each target project's .claude/hooks/
test/installer.test.mjs
```