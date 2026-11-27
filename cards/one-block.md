---
card: one-block
state: ADOPT, PLAN, LOOP, GATE
role: root
loads: status, in ADOPT, PLAN, every loop and GATE; the loop-breaker's packet carries it too
---
The one-block: after the step back, write the next action whole, as one block, before anyone acts on it: `{{cmd}} block "<…>"` (or `block --file <path>`). The board shows it under `## Next action`; builders get it in their packets.
- Write it in the representation the work reads best in: a code sketch, a table, a list of files with what each does.
- A loop: a quick sketch of the items being built (core and non-core) and how they fit: the interfaces, the route of the behaviour, the real inputs. Each builder's handoff is a part of this block, never drafted separately.
- The plan: goals, design and acceptance together, before they are split into the acceptance list and the handoffs.
- Adoption: what exists, whole.
- The release gate: what the prune removes, the end-to-end command and why it is the user's real path, and what the review must see.
- Keep it to what the step needs. If the block does not hold together, the step back is not done.
