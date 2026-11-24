---
card: gate
state: GATE
role: root
loads: status, in GATE
---
Certify the stage on one commit.
- Core gate: scope every reviewable CORE criterion. Release gate: scope everything; first remove what does not trace to a goal, a real input or an observed failure (verification included), and record it: `{{cmd}} prune "<what was removed>"` or `prune none`; commit.
- Then `{{cmd}} run --e2e -- <the product end to end, on its normal path and speed>` on that commit: what its user would run, not a shortcut.
- `call reviewer`, `review <id>`, `reproduce` every NOT_MET. Any later commit, docs included, repeats the e2e run and the review.
- PASS: core gate → NON-CORE stage (the list freezes hard); release gate → ACCEPT. Otherwise the failing criteria become the next loop's targets.
