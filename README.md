# CheapGPT

CheapGPT installs a **project-local** Codex orchestration policy into a repository's root `AGENTS.md`. The goal is the fewest expensive tokens per correct change. The root model plans, decides, integrates and verifies. A dynamic implementer (Terra) takes every task that needs judgment, and a mechanical implementer (Luna) takes every task the handoff fully determines. Fresh reviewers check the plan and the build twice each: once when the core is done and again when it is complete. When a review fails, a fresh loop-breaker takes over a new cycle instead of letting work spiral.

This is **not** a global Codex install. It does **not** write `~/.codex`, does **not** change other repositories, and does **not** apply to every thread on your machine. It only mutates the target project folder you pass as `--project`. Every repository, worktree, or project that should use CheapGPT needs its own install into **that folder's** `AGENTS.md` (and that folder's `.codex/` hooks). If you start a new repo tomorrow, install CheapGPT there again.

Do **not** copy-paste profile text by hand. LLMs drift, summarize, and "fix" wording. Always run `install.mjs` so markers, hashes, and uninstall still work.

## For AI coding agents (Codex, Claude Code, Cursor, OpenCode)

If a human asked you to install CheapGPT into the **current** project:

1. This policy applies only to the current project directory. Never install into the user's home Codex config and never treat it as a global skill.
2. Ask which profile to use if they did not name one. Recommend from the table below.
3. Locate this CheapGPT checkout (clone it if needed). Profiles live next to `install.mjs`; do not pipe the script from curl without the `profiles/` directory.
4. Run the installer with Node 18+ from the **target project** as `--project`:

```bash
node /path/to/cheapGPT/install.mjs install --project . --profile cheap
```

Windows PowerShell:

```powershell
node C:\path\to\cheapGPT\install.mjs install --project . --profile cheap
```

5. Do not edit `AGENTS.md` yourself to insert the prompt. Do not install more than one profile. Do not dump all profiles into context.
6. After install, tell the human: trust this project in Codex, review `/hooks`, and optionally select the profile's preferred root. An already-running Codex root continues if it differs.

### Update an existing CheapGPT install

If this project already has a CheapGPT managed block or `.cheapgpt/state.json`, do **not** copy new prompt text by hand. `update` replaces only CheapGPT-owned files (the managed `AGENTS.md` block, `.cheapgpt/state.json`, and CheapGPT hook entries/script) and preserves user-owned instructions outside the markers. Installs of the retired `cheap-5x` and `cheap-20x` profiles move to `cheap-100` on `update`.

```bash
node /path/to/cheapGPT/install.mjs update --project . --dry-run
node /path/to/cheapGPT/install.mjs update --project .
node /path/to/cheapGPT/install.mjs doctor --project .
```

Stop before writing if markers are malformed or `update` reports a hand-modified managed block (review, then `--force` only if intended). After a successful update, tell the human to re-review/trust `/hooks` because the hook definition hash changed, then start a fresh turn. `doctor` validates installed files against this checkout; it is not evidence that Codex executed a heartbeat on a given turn.

Sibling checkout example (CheapGPT next to the app):

```bash
node ../cheapGPT/install.mjs --project . --profile cheap
```

## What it does

CheapGPT owns exactly one bounded block in the target repo:

```html
<!-- cheapgpt:managed:start -->
...one active profile...
<!-- cheapgpt:managed:end -->
```

Everything outside that block is the user's. Install/update replace only the CheapGPT block. Uninstall removes only CheapGPT files.

Three layers keep the policy alive in Codex:

| Layer | Role |
| --- | --- |
| `AGENTS.md` managed block | Constitution. Codex already loads project `AGENTS.md`. One profile only. |
| `UserPromptSubmit` hook | Heartbeat. A short per-turn reminder (under 1 KB for cheap profiles), not the full profile text. |
| `SessionStart` matcher `compact` | Recovery. After compaction, rehydrates the full current managed block once. |

Normal turns do **not** re-inject the full prompt. Project-local hooks run only when Codex trusts the project; `AGENTS.md` still works if hooks are skipped.

Written into the target project:

```text
AGENTS.md                         # bounded CheapGPT block appended or replaced
.cheapgpt/state.json              # profile, hashes, hook mode
.codex/config.toml                # project-local MultiAgent V2 wait backstop
.codex/hooks.json                 # CheapGPT entries merged; other hooks kept
.codex/hooks/cheapgpt-turn.mjs    # heartbeat + compact recovery
```

While a task runs, the root also keeps `cheapgpt/plan.md` (the board) and `temporary/` (scratch files) in the project. Both are git-excluded and deleted when the task passes.

## Profiles

Install **exactly one**. They are mutually exclusive.

| Profile | Account | Use when | Root | Dynamic (Terra) | Mechanical (Luna) | Reviewers | Loop-breaker | Board budget |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| `cheap` | ChatGPT Plus | Medium-hard tasks | sol-6.1-medium (`gpt-6.1-sol` medium) | `gpt-6.1-terra` medium | `gpt-6-luna` max | `gpt-6.1-sol` medium | `gpt-6.1-sol` xhigh | 20,000 |
| `cheap-100` | ChatGPT Pro | Hardest tasks | sol-6.1-xhigh (`gpt-6.1-sol` xhigh) | `gpt-6.1-terra` max | `gpt-6-luna` max | `gpt-6.1-sol` xhigh | `gpt-6-astra` xhigh | 25,000 |
| `ultracheap` (legacy) | ChatGPT Plus | Simple tasks | luna-6-max (`gpt-6-luna` max) | — (root implements) | — | `gpt-6-luna` max | fresh `gpt-6.1-sol` medium replanner | 15,000 |

`ultracheap` is a **legacy** profile. It keeps the previous orchestration design and is not maintained against the current flow. A new ultracheap flow will be released once good cheap models and big models at a decent price make it viable.

Preferred root is the economical/capability configuration CheapGPT recommends. It does not override Codex's harness/system model identity and is not a prerequisite for execution. If the already-running root differs, work continues without a switch.

## How a task runs (cheap, cheap-100)

1. **Route.** The root picks a route and states it in one line:
   - DIRECT: one obvious local edit, or a bounded operational task with a known procedure. The root does it, confirms it by the check or the operation's real output, and is done, with no children and no board.
   - FOCUSED: known mechanism.
   - FULL: unsettled mechanism, unfamiliar tech, costly failure, or any behavior that depends on model output.
2. **PLAN.** The root writes the acceptance list and the mechanism (the core plan), which a fresh reviewer checks. Then it writes the handoffs (the complete plan), which a new fresh reviewer checks.
3. **BUILD.** Terra and Luna build the core path first, which gets a review. Then they build the rest, which gets a terminal review. A repair that doesn't fix the problem is reverted, and the root goes back to PLAN instead of patching again.
4. **Reviews.** Core reviews return `PASS`, `FIX` or `ESCALATE`; terminal reviews return `PASS` or `UNRESOLVED`. A finding counts only with a criterion, evidence and one action.
5. **Loop-breaking.**
   - Any terminal `UNRESOLVED` starts a new cycle led by a fresh loop-breaker.
   - Two loop-breaker cycles without a pass, or one without significant advance (more acceptance criteria passing on a real run), lead to one **step back**: a big-picture review that names the step at fault and replans from there.
   - After two more cycles without a pass, the task stops **BLOCKED** with EXPLORE/RESEARCH options for you.
6. **Issue report.** After a task that needed a loop-breaker, the step back, or more than two fix rounds on one review finally passes, the root drafts a project-neutral issue for this repo and files it only if you say yes.

## Install / update / doctor / uninstall

Requires Node 18+ and a checkout of this repo (so `profiles/` and `hooks/` sit beside `install.mjs`). No npm publish, no `npm install`, no global CLI.

```bash
node /path/to/cheapGPT/install.mjs install --project . --profile cheap
node /path/to/cheapGPT/install.mjs update --project .
node /path/to/cheapGPT/install.mjs update --project . --profile cheap-100
node /path/to/cheapGPT/install.mjs doctor --project .
node /path/to/cheapGPT/install.mjs uninstall --project .
```

Useful flags:

```text
--dry-run       validate and print the plan; write nothing
--force         overwrite a CheapGPT block you edited by hand
--json          machine-readable output
--no-hooks      AGENTS.md only (no Codex heartbeat/recovery)
--hooks         install hooks (default)
```

`--global` is rejected on purpose.

If you hand-edit the managed block, `doctor` fails and `update`/`uninstall` refuse until `--force`.

## Branches

- `main`: this Codex edition.
- `claude-edition`: the same flow for Claude Code (CLAUDE.md, native subagents).
- `exp`: experimental, with a Claude Code root and Terra/Luna running as Codex CLI sessions.

## Tests

```bash
node --test test/installer.test.mjs
```

## Layout

```text
install.mjs              zero-dependency installer (node:fs, node:crypto, node:path)
profiles/*.md            canonical opaque profile policies
profiles/catalog.json    profile metadata + heartbeat turn reminder
hooks/cheapgpt-turn.mjs  copied into each target project's .codex/hooks/
test/installer.test.mjs
```