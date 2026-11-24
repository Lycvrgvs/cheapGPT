---
card: merge
state: LOOP
level: tiny
role: root
loads: status, in a loop at level tiny
---
Merge: `{{cmd}} merge <id>[,<id>]` merges the builders' branches, each committed in its own worktree cut from BASE. The tool refuses paths both builders changed: that means the allocation was wrong, so re-allocate; never reconcile by hand. After the merge you may commit only the seam (wiring, imports, a shared signature the handoffs fixed); anything else goes back to its builder. Then run the affected path on the merged HEAD.
