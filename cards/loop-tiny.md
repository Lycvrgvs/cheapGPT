---
card: loop-tiny
state: LOOP
level: tiny
role: root
loads: status, in a loop at level tiny
---
Tiny loop: one behaviour to build or fix, on BASE.
1. PREVENT: your step back (step-back card), in a few lines: `{{cmd}} stepback tiny --targets <IDs> "<the whole, the class and root cause, what to remove, the real property, the one correction, the allocation>"`. A target that already failed: reproduce it on BASE first (`{{cmd}} run --before -- <command>`; `--judgment` when the evidence is the criterion's real output).
2. BUILD: `{{cmd}} call dynamic` and/or `{{cmd}} call mechanical`, one each at most, on disjoint paths. Each call writes the builder's card into its packet; append the handoff for this loop. Never spawn an idle builder: record an empty allocation in the step back.
3. MERGE (merge card), then `{{cmd}} run -- <the affected path>` on HEAD.
4. REVIEW: `{{cmd}} call reviewer`, append the targets' plan lines and the run evidence to its packet, then `review <id>`. Settle every NOT_MET with the command that decides it, run by the engine: `{{cmd}} reproduce <ID> yes -- <command>` (it must fail), `no -- <command>` (it must pass; the criterion holds), or `missing "<why>"` when the deciding run cannot be made (the criterion stays open, not a defect). Add `--judgment` when the evidence is the output, not the exit code. The engine gives the outcome and the next level.
