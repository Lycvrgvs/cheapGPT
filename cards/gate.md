---
card: gate
state: GATE
role: root
loads: status, in GATE
---
The release gate: every item, core and non-core, judged on one commit, end to end, by a fresh reviewer.
- PREVENT: `{{cmd}} stepback "<the whole plan, all the evidence, the one risk>"`, then `{{cmd}} block "<the gate, whole>"` (the one-block card).
- Then remove what does not trace to a goal, a real input or an observed failure (verification included, and the reviews' Noise), and record it: `{{cmd}} prune "<what was removed>"` or `prune none`; commit.
- Then `{{cmd}} run --e2e -- <the product end to end, on its normal path and speed>` on that commit: what its user would run, not a shortcut.
- `call reviewer`, `review <id>`, `reproduce` every NOT_MET. Any later commit, docs included, repeats the e2e run and the review.
- PASS → `advance ACCEPT`. Otherwise the failing items go back to tiny loops on the current level: `advance LOOP`.
