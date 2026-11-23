# CheapGPT — Claude Code edition

CheapGPT installs a **project-local** Claude Code orchestration policy into a repository's root `CLAUDE.md`. The goal is the fewest expensive tokens per correct change. The strongest model in the profile writes the plan; the Opus root orchestrates, integrates and verifies without writing code. A dynamic builder (Sonnet) takes every task that needs judgment, and a mechanical builder (Haiku) takes every task the plan fully determines. Every build is a tiny loop: a step back, the builders in parallel, a merge, a real run and a fresh review. A loop that keeps failing escalates from the root to a fresh loop-breaker, then to a re-plan that you approve. From 1.9.0 a small tool, `.cheapgpt/cheapgpt.mjs`, enforces the flow: what can be computed (states, outcomes, the escalation ladder, the evidence each step owes) is checked by code, and the prompt keeps only judgment. This branch is the Claude Code edition; `main` is the Codex edition.

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

After install or update, open the project in Claude Code, accept the workspace trust dialog, review `/hooks`, and set the root model to the profile's recommended root with `/model` (`cheap`: Opus 5.5 medium; `cheap-100`: Opus 5.5 high). The committed `.claude/` config works in the CLI, desktop, and web sessions.

## What it writes

```text
CLAUDE.md                          # bounded CheapGPT block appended or replaced
.cheapgpt/state.json               # profile, hashes, hook mode
.cheapgpt/cheapgpt.mjs             # the flow tool
.claude/settings.json              # CheapGPT hook entries merged into "hooks"; other keys kept
.claude/hooks/cheapgpt-turn.mjs    # heartbeat (UserPromptSubmit) + short compact reminder (SessionStart: compact)
```

Claude Code re-reads the project-root `CLAUDE.md` after compaction, so the compact hook injects only the turn reminder, never the whole block. While a task runs, `.cheapgpt/cheapgpt.mjs` keeps its record in `cheapgpt/` (the plan, the state and log, a rendered board, call packets and replies, worktrees) and scratch files in `temporary/`. Both are git-excluded and removed when the task is done.

## Profiles

Install **exactly one**.

| Profile | Use when | Root | Dynamic builder | Mechanical builder | Reviewers | Planner and loop-breaker |
| --- | --- | --- | --- | --- | --- | --- |
| `cheap` | medium-hard tasks | opus-5.5-medium | Sonnet 5.5 medium | Haiku 5.5 xhigh | Opus 5.5 medium | Opus 5.5 xhigh |
| `cheap-100` | hardest tasks | opus-5.5-high | Sonnet 5.5 xhigh | Haiku 5.5 xhigh | Opus 5.5 high | Fable 5.1 xhigh |

There is no `ultracheap` on this branch; it remains a legacy Codex profile on `main`.

Every subagent is spawned with Claude Code's native `Agent` tool and an explicit `model` and `effort`. A fork would run on the root's model, so implementers can't inherit the root conversation. Instead, the planner and each implementer get a conversation packet with their first assignment and are continued through `SendMessage`. Reviewers and loop-breakers are always new subagents.

The flow is the same as on `main`:

1. **Route.** The root picks a route and states it in one line:
   - DIRECT: one obvious local edit, or a bounded operational task with a known procedure. The root does it, confirms it by the check or the operation's real output, and is done, without the tool, children or board.
   - FOCUSED: known mechanism; the root writes the plan.
   - FULL: unsettled mechanism, unfamiliar tech, costly failure, or any behavior that depends on model output; the planner (the loop-breaker model) writes the plan.
2. **Adopt and preflight.** On an existing project the root first records a real baseline run. Every role's model is confirmed from the harness's own record, and a reviewer call is checked to leave the repository unchanged.
3. **PLAN.** Goals in your words, single-property criteria (CORE or NON-CORE) each with the real run that decides it and its boundary case, plus Backlog and Drop. Criteria only you can judge stay on the list for you. The tool refuses a plan that does not trace every criterion to a goal. On existing code a fresh reviewer checks the plan once.
4. **BUILD in tiny loops.** Every build is a tiny loop: a step back, the dynamic and mechanical builders in parallel in their own worktrees, a merge, a real run and a fresh read-only review. The tool computes the outcome (PASS, ADVANCED, STALLED, REGRESSION, BLOCKED) and keeps BASE, the build with the most criteria passing.
5. **Step backs that look at the whole.** Every step back reads all the evidence, names the class of failure and its root cause, considers removal first and checks the evidence shows the real property. The root takes it in a few lines; repeated failures move it to a fresh loop-breaker (a few paragraphs, then it builds alone); repeated failures there move it to a re-plan with you, which you approve before anything is built.
6. **Gates.** A core gate and a release gate each run the product end to end on the exact commit a fresh reviewer then judges. The acceptance list freezes when the core gate passes.
7. **Delivery and issue report.** You get the split acceptance table, the criteria left to you with what to try, and the gated commit. After a task that needed a full step back or a re-plan, the root may draft a universal, project-neutral issue for this repo, filed only if you say yes.

## Using cheapGPT builders with cLoop

cheapGPT and [cLoop](https://github.com/Lycvrgvs/cLoop) are never installed in the same project: each is a complete orchestration policy, and two would compete for the same root. To have cLoop's council run the process while cheapGPT's economical builders do the building, install cLoop alone with its `--builders cheap` or `--builders cheap-100` option (from cLoop's next release). cLoop reads the builder models from `profiles/roles.json`, which every cheapGPT branch publishes.

| cheapGPT branch | Matching cLoop branch |
| --- | --- |
| `main` | `codex` |
| `exp` | `main` |
| `claude-edition` | `claude` |

This branch pairs with cLoop's `claude` branch. If cLoop is already installed in a project, `install` and `update` stop before writing anything and print both choices: keep cLoop with cheapGPT's builders, or uninstall cLoop and keep cheapGPT.

## Tests

```bash
node --test test/installer.test.mjs test/cheapgpt.test.mjs
```

## Layout

```text
install.mjs              zero-dependency installer
profiles/*.md            canonical profile policies (Claude Code edition)
profiles/catalog.json    profile metadata and turn reminders
profiles/roles.json      published roles table for cLoop (generated by tools/roles.mjs)
cloop-guard.mjs          stops install/update when cLoop is present
tools/roles.mjs          roles.json generator
cheapgpt.mjs             the flow tool, installed into each project as .cheapgpt/cheapgpt.mjs
test/cheapgpt.test.mjs   every guard of the flow tool, seen refusing and passing
hooks/cheapgpt-turn.mjs  copied into each target project's .claude/hooks/
test/installer.test.mjs
```