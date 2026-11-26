---
card: adopt
state: ADOPT
role: root
loads: status, in ADOPT (an existing project)
---
Understand the project before planning; adoption never changes the product. It starts with a prevent (the step-back and one-block cards).
- Read the history, the docs and the existing checks.
- Run the product's real path once on HEAD: `{{cmd}} run -- <command>`. This is the baseline; it separates what was already broken from what the task breaks.
- Step back over the whole project: `{{cmd}} stepback "<the goal, what the code is for, where it stands, the one risk>"`.
- The one-block is what exists, whole: `{{cmd}} block "<behaviour, layout, checks, what the baseline run showed, which existing checks are protected>"`. A protected check is never edited or weakened to pass.
- Then `{{cmd}} advance PLAN`.
