---
card: loop-replan
state: LOOP
level: replan
role: root
loads: status, in a loop at level replan
---
Re-plan: the full step back, with the user deciding.
1. Show the user the targets, what was tried, the evidence, and 2-3 options with your recommendation. Record their words: `{{cmd}} replan [--targets <IDs>] "<their comment>"`. If they say stop: `advance STOPPED`.
2. `{{cmd}} call breaker` with their comment in the packet: the loop-breaker takes the full step back and rewrites the plan from the step at fault. Record its step back (`stepback replan --targets <IDs> "..."`), write the new plan to cheapgpt/plan.md and `freeze` (with `--user "<their words>"` for a changed goal, a removed criterion, or any change after the hard freeze).
3. Show the user the step back and the new plan; record their approval: `{{cmd}} approve "<their words>"`. Only then does the same loop-breaker build; `run --before` on BASE for a target that already failed.
4. `merge <id>`, run the affected path, then call reviewer, review, reproduce.
