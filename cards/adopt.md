---
card: adopt
state: ADOPT
role: root
loads: status, in ADOPT (an existing project)
---
Understand the project before planning; adoption never changes the product.
- Read the history, the docs and the existing checks.
- Run the product's real path once on HEAD: `{{cmd}} run -- <command>`. This is the baseline; it separates what was already broken from what the task breaks.
- Record it: `{{cmd}} adopt "<what exists, what works on the baseline run, which existing checks are protected>"`. A protected check is never edited or weakened to pass.
- Then `{{cmd}} advance PLAN`.
