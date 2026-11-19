# CheapGPT — Claude Code edition

CheapGPT installs a **project-local** Claude Code orchestration policy into a repository's root `CLAUDE.md`. The goal is the fewest expensive tokens per correct change. The strongest model in the profile writes the plan; the Opus root orchestrates, integrates and verifies without writing code. A dynamic implementer (Terra, a Codex CLI session) takes every task that needs judgment, and a mechanical implementer (Luna, a Codex CLI session) takes every task the plan fully determines. Failures are fixed in tiny loops checked by real runs. A fix that fails gets one deep diagnosis by the strongest model; if that fails too, the task stops and comes back to you instead of spiraling. This branch is the Claude Code edition; `main` is the Codex edition.

It is **not** a global install. It never writes `~/.claude` and only mutates the target project folder you pass as `--project`. Every repository that should use CheapGPT needs its own install. Do not copy-paste profile text by hand; always run `install.mjs` so markers, hashes, and uninstall keep working.

## EXP branch: Codex CLI implementers

This `exp` branch is the Claude Code edition with one difference: the two implementers are **Codex CLI sessions** driven directly by the Opus root. The root orchestrates, reviews evidence and invokes the loop-breaker; Terra and Luna do the implementation.

| Profile | Root | Dynamic (Terra) | Mechanical (Luna) | Reviewers | Planner and loop-breaker | Board |
| --- | --- | --- | --- | --- | --- | ---: |
| `cheap` | opus-5.5-medium | `gpt-6.1-terra` medium | `gpt-6-luna` max | Opus 5.5 medium | Opus 5.5 xhigh | 20,000 |
| `cheap-100` | opus-5.5-medium | `gpt-6.1-terra` max | `gpt-6-luna` max | Opus 5.5 medium | Fable 5.1 xhigh | 25,000 |

**How the implementers run:**
- Each implementer is one persistent session for the whole task: `codex exec` first, then `codex exec resume <thread_id>` for every later assignment.
- Each call's packet and output live in `temporary/runs/<call-id>/`.
- The root reads only `out.md`.

**Requirements:**
- `codex` on `PATH` and logged in.
- The installer adds `Bash(codex exec:*)` to `.claude/settings.json` permissions, and uninstall removes it.
- `AGENTS.md` must not hold a CheapGPT block, because Codex sessions would load it as their own orchestration policy. `doctor` reports it if it does.

## Install / update / doctor / uninstall

Requires Node 18+ and a checkout of this branch (so `profiles/` and `hooks/` sit beside `install.mjs`).

```bash
node /path/to/cheapGPT/install.mjs install --project . --profile cheap
node /path/to/cheapGPT/install.mjs update --project .
node /path/to/cheapGPT/install.mjs doctor --project .
node /path/to/cheapGPT/install.mjs uninstall --project .
```

Flags: `--dry-run`, `--force` (overwrite a hand-edited CheapGPT block), `--json`, `--no-hooks`, `--hooks` (default). `--global` is rejected.

After install or update, open the project in Claude Code, accept the workspace trust dialog, review `/hooks`, and set the root model to the profile's recommended root with `/model` (`cheap`: Opus 5.5 medium; `cheap-100`: Opus 5.5 medium). The committed `.claude/` config works in the CLI, desktop, and web sessions.

## What it writes

```text
CLAUDE.md                          # bounded CheapGPT block appended or replaced
.cheapgpt/state.json               # profile, hashes, hook mode
.claude/settings.json              # CheapGPT hook entries merged into "hooks"; other keys kept
.claude/hooks/cheapgpt-turn.mjs    # heartbeat (UserPromptSubmit) + short compact reminder (SessionStart: compact)
```

Claude Code re-reads the project-root `CLAUDE.md` after compaction, so the compact hook injects only the turn reminder, never the whole block. While a task runs, the root also keeps `cheapgpt/plan.md` (the board) and `temporary/` (scratch files). Both are git-excluded and deleted when the task passes.

## Profiles

Install **exactly one** profile from the table above. There is no `ultracheap` on this branch; it remains a legacy Codex profile on `main`.

The planner, reviewers and loop-breaker are spawned with Claude Code's native `Agent` tool and an explicit `model` and `effort`. The planner gets a conversation packet with its first assignment and is continued through `SendMessage`; reviewers and loop-breakers are always new subagents.

The flow is the same as on `main`:
- route (DIRECT / FOCUSED / FULL);
- PLAN by the planner (the loop-breaker model), reviewed once on existing code;
- BUILD: core first on a real run and reviewed right away, then the rest and a final review;
- failures fixed in tiny loops checked by real runs;
- a failed fix gets one full step back by a fresh loop-breaker, then BLOCKED with EXPLORE/RESEARCH options;
- an issue draft only after a hard task finally passes.

## Using cheapGPT builders with cLoop

cheapGPT and [cLoop](https://github.com/Lycvrgvs/cLoop) are never installed in the same project: each is a complete orchestration policy, and two would compete for the same root. To have cLoop's council run the process while cheapGPT's economical builders do the building, install cLoop alone with its `--builders cheap` or `--builders cheap-100` option (from cLoop's next release). cLoop reads the builder models from `profiles/roles.json`, which every cheapGPT branch publishes.

| cheapGPT branch | Matching cLoop branch |
| --- | --- |
| `main` | `codex` |
| `exp` | `main` |
| `claude-edition` | `claude` |

This branch pairs with cLoop's `main` branch. If cLoop is already installed in a project, `install` and `update` stop before writing anything and print both choices: keep cLoop with cheapGPT's builders, or uninstall cLoop and keep cheapGPT.

## Tests

```bash
node --test test/installer.test.mjs
```

## Layout

```text
install.mjs              zero-dependency installer
profiles/*.md            canonical profile policies (Claude Code edition)
profiles/catalog.json    profile metadata and turn reminders
profiles/roles.json      published roles table for cLoop (generated by tools/roles.mjs)
cloop-guard.mjs          stops install/update when cLoop is present
tools/roles.mjs          roles.json generator
hooks/cheapgpt-turn.mjs  copied into each target project's .claude/hooks/
test/installer.test.mjs
```