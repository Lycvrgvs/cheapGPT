---
card: loop-tiny
state: LOOP
level: tiny
role: root
loads: status, in a loop at level tiny
---
Tiny loop: build the next items of the acceptance list, on BASE.
1. PREVENT: `{{cmd}} stepback tiny --targets <IDs> "<the whole, the class and root cause, what to remove, the real property, the one risk, the allocation>"` (a few lines), then `{{cmd}} block "<the sketch of what this loop builds>"`. A target that already failed: reproduce it on BASE first (`{{cmd}} run --before -- <command>`; `--judgment` when the evidence is the criterion's real output).
2. BUILD: `{{cmd}} call dynamic` and/or `{{cmd}} call mechanical`, one each at most, on disjoint paths. Each packet carries the builder's card and the one-block; append the handoff, its part of the block. Never spawn an idle builder: record an empty allocation in the step back.
3. MERGE (the merge card), then `{{cmd}} run -- <the affected path>` on HEAD.
4. REVIEW: FOCUSED: your mini-review (its card). FULL: `{{cmd}} call reviewer`, append the targets' plan lines and the run evidence to its packet, then `review <id>`.
5. Settle every NOT_MET with the command that decides it, run by the engine: `{{cmd}} reproduce <ID> yes -- <command>` (it must fail), `no -- <command>` (it must pass; the criterion holds), or `missing "<why>"` when the deciding run cannot be made (the item stays open, not a defect). Add `--judgment` when the evidence is the output, not the exit code. The engine gives the outcome and the next level.
6. Items still open: `advance LOOP`. Every item established: `advance GATE`.
