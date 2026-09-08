# CheapGPT

CheapGPT installs a **project-local** Codex orchestration policy into a repository's root `AGENTS.md`. The persistent root model does the implementation; GPT-6 Astra is spawned only as a native planning advisor and a native reviewer. The point is to keep expensive model output small without starving agents of the context they need.

This is **not** a global Codex install. It does **not** write `~/.codex`, does **not** change other repositories, and does **not** apply to every thread on your machine. It only mutates the target project folder you pass as `--project`. Every repository, worktree, or project that should use CheapGPT needs its own install into **that folder's** `AGENTS.md` (and that folder's `.codex/` hooks). If you start a new repo tomorrow, install CheapGPT there again.

Do **not** copy-paste profile text by hand. LLMs drift, summarize, and "fix" wording. Always run `install.mjs` so markers, hashes, and uninstall still work.

## For AI coding agents (Codex, Claude Code, Cursor, OpenCode)

If a human asked you to install CheapGPT into the **current** project:

1. This policy applies only to the current project directory. Never install into the user's home Codex config and never treat it as a global skill.
2. Ask which profile to use if they did not name one. Recommend from the table below.
3. Locate this CheapGPT checkout (clone it if needed). Profiles live next to `install.mjs`; do not pipe the script from curl without the `profiles/` directory.
4. Run the installer with Node 18+ from the **target project** as `--project`:

```bash
node /path/to/cheapGPT/install.mjs --project . --profile ultracheap
```

Windows PowerShell:

```powershell
node C:\path\to\cheapGPT\install.mjs --project . --profile ultracheap
```

5. Do not edit `AGENTS.md` yourself to insert the prompt. Do not install more than one profile. Do not dump all profiles into context.
6. After install, tell the human: trust this project in Codex, review `/hooks`, select the profile's required root model, then start a **plan-only** first turn unless they overrode that.

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

Two layers keep the policy alive in Codex:

| Layer | Role |
| --- | --- |
| `AGENTS.md` managed block | Constitution. Codex already loads project `AGENTS.md`. One profile only. |
| `UserPromptSubmit` hook | Heartbeat. Tiny per-turn reminder plus planning/implementation mode lines. |
| `SessionStart` matcher `compact` | Recovery. After compaction, rehydrates the full current managed block once. |

Normal turns do **not** re-inject the full prompt. Project-local hooks run only when Codex trusts the project; `AGENTS.md` still works if hooks are skipped.

Written into the target project:

```text
AGENTS.md                         # bounded CheapGPT block appended or replaced
.cheapgpt/state.json              # profile, hashes, hook mode
.codex/hooks.json                 # CheapGPT entries merged; other hooks kept
.codex/hooks/cheapgpt-turn.mjs    # heartbeat + compact recovery
```

## Profiles

Install **exactly one**. They are mutually exclusive.

| Profile | Account | Use when | Persistent root | Plan advisor | Reviewer |
| --- | --- | --- | --- | --- | --- |
| `ultracheap` | ChatGPT Plus | Simple tasks | Luna xHigh | Astra-medium | Astra-low |
| `cheap` | ChatGPT Plus | Medium-hard tasks | Luna Max | Astra-xhigh | Astra-medium |
| `cheap-5x` | ChatGPT Pro 5x | Hardest tasks | Sol-high | Astra-xhigh | Astra-medium |
| `cheap-20x` | ChatGPT Pro 20x | Hardest tasks | gpt-5.6-sol xhigh | Astra-xhigh | Astra-medium |

`cheap-5x` and `cheap-20x` use Sol as root because Sol is stronger at implementing than Luna; Astra still plans and reviews. Pick `ultracheap` to save Plus credits on small work, `cheap` when Plus work is actually hard, and a Sol profile only if the account is Pro 5x/20x and the task is brutal.

## How to use it in a repo / thread

1. Install into **this** project (`--project .`). Repeat for every other project.
2. In Codex, open that project, trust it, and review `/hooks` so CheapGPT heartbeat/recovery can run.
3. Set the thread's root model to the profile's required root **before** asking for work. If the running model is wrong, the policy tells the agent to stop and ask you to switch or explicitly approve a substitute root.
4. For each new feature or debug: first turn is **plan only** (root inspects, Astra advises, root owns the plan, no edits) unless you say otherwise (`skip planning`, `just implement`). Second and later turns implement, test, then Astra-review until `PASS`.
5. Mid-thread root change: tell the new root that the model and loop are changing. It must re-read `AGENTS.md`, recover thread/repo context, and continue the profile's loop on the next turn.

Example thread start after `ultracheap` install:

> Use CheapGPT. Plan first, then wait. Task: …

Example override:

> Skip planning and implement this fix.

Example mid-thread switch after installing `cheap-5x` into the same project:

> We are changing the root to Sol-high and the CheapGPT cheap-5x loop. Read AGENTS.md and prior context, then continue next turn.

## Install / update / doctor / uninstall

Requires Node 18+ and a checkout of this repo (so `profiles/` and `hooks/` sit beside `install.mjs`). No npm publish, no `npm install`, no global CLI.

```bash
node /path/to/cheapGPT/install.mjs install --project . --profile ultracheap
node /path/to/cheapGPT/install.mjs update --project .
node /path/to/cheapGPT/install.mjs update --project . --profile cheap
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

## Tests

```bash
node --test test/installer.test.mjs
```

## Layout

```text
install.mjs              zero-dependency installer (node:fs, node:crypto, node:path)
profiles/*.md            canonical opaque profile policies
profiles/catalog.json    profile metadata + heartbeat mode lines
hooks/cheapgpt-turn.mjs  copied into each target project's .codex/hooks/
test/installer.test.mjs
```
