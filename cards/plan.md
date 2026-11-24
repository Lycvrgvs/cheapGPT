---
card: plan
state: PLAN
role: root
loads: status, in PLAN
---
Write `cheapgpt/plan.md` (FOCUSED: you; FULL: the planner, with the planner card) with these sections:
- `## Goals`: `- G<n> | <the user's words> | <criterion IDs>` or `| Drop: <reason>`. Every goal maps somewhere.
- `## Acceptance`: `- C<n> | CORE|NON-CORE | <one property> | run: <the real run that decides it> | boundary: <the closest input where a wrong result would still look right> [| judge: user — <what the user should try>]`.
  - CORE: the objective fails without it, others depend on it, or its failure is severe or irreversible. Everything else needed is NON-CORE.
  - One property per criterion: "and" in a property usually means two criteria.
  - If an obviously wrong output would still pass, add the criterion that rejects it.
  - `judge: user` only for what no run can decide (taste, enjoyment, ease of learning); it stays on the list for the user at ACCEPT.
- `## Backlog` (valid, optional), `## Drop` (out of scope, with the reason).
- `## Mechanism` (never one a veto names) and `## Handoffs`: what each builder needs (see the dynamic and mechanical cards) and what the review must see.
Fix the plan's wording only where an ambiguity would lead a builder to a wrong result. Ask the user only what is theirs.
Then `{{cmd}} freeze`: the list is provisional until the core gate passes.
Adopted project: a fresh reviewer checks the plan once (`call reviewer`, then `planreview <id>`); apply a FIX once, freeze again, then `advance LOOP`.
