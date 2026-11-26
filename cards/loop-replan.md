---
card: loop-replan
state: LOOP
level: replan
role: root
loads: status, in a loop at level replan
---
Re-plan: the user decides, twice. Each message says which decision it asks for. Any clear yes or no is their answer; never dictate a phrase for them to type. An unclear reply gets one plain follow-up question. At either ask the user may stop the task: record their words with `{{cmd}} replan "<their words>"`, then `advance STOPPED`.
1. Their comment. In plain words: what was tried, what keeps failing and why it matters to them, the current behaviour from a real run, 2-3 options and your recommendation. Say that their reply feeds a new plan they will see before anything is built. Record it: `{{cmd}} replan [--targets <IDs>] "<their words>"`.
2. `{{cmd}} call breaker` with their comment in the packet. Record its prevent: `stepback replan --targets <IDs> "<its full step back>"` and `block "<the new plan, whole>"`; write the new plan to cheapgpt/plan.md and `freeze` (with `--user "<their words>"`).
3. Their decision on the plan. Show the loop-breaker's plan in plain words. Mark what differs from their comment and anything it newly commits to; when nothing material differs, say so. Say that a yes starts the build.
- Yes: `{{cmd}} approve "<their words>"`; only then does the same loop-breaker build (`run --before` on BASE for a target that already failed), then `merge <id>`, run, review, reproduce.
- No, with a new comment: `{{cmd}} replan "<their words>"` starts the re-plan again from step 2.
