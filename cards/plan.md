---
card: plan
state: PLAN
role: root
loads: status, in PLAN
---
The plan is one block first, split second. FOCUSED: you plan (fast). FULL: the planner plans (the planner card); you record its step back and one-block.
1. PREVENT: `{{cmd}} stepback "<the goals, what is known and unknown, the one risk>"`, then `{{cmd}} block "<goals, design and acceptance drafted together>"`.
2. Split the block into `cheapgpt/plan.md`:
- `## Goals`: `- G<n> | <the user's words> | <criterion IDs>` or `| Drop: <reason>`. Every goal maps somewhere.
- `## Acceptance`: `- C<n> | CORE|NON-CORE | <one property> | run: <the real run that decides it> | boundary: <the closest input where a wrong result would still look right> [| judge: user — <what the user should try>]`.
  - CORE: the objective fails without it, others depend on it, or its failure is severe or irreversible. Everything else needed is NON-CORE. Both are built in the same loops; the tag says what matters most, not when it is built.
  - One property per criterion: "and" in a property usually means two criteria.
  - If an obviously wrong output would still pass, add the criterion that rejects it.
  - `judge: user` only for what no run can decide (taste, enjoyment, ease of learning); it stays on the list for the user at ACCEPT.
- `## Backlog` (valid, optional), `## Drop` (out of scope, with the reason).
- `## Mechanism` (never one a veto names) and `## Handoffs`: what each builder needs (the dynamic and mechanical cards) and what the review must see. Every handoff comes from the same block.
Ask the user only what is theirs.
3. Pre-freeze: `{{cmd}} freeze`, then `advance LOOP`. After that only a re-plan with the user changes the list.
Adopted project: before `advance LOOP`, a fresh reviewer checks the plan once (`call reviewer`, then `planreview <id>`); apply a FIX once and freeze again.
