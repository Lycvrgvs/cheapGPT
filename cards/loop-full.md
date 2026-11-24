---
card: loop-full
state: LOOP
level: full
role: root
loads: status, in a loop at level full
---
Full step back: a fresh loop-breaker takes the step back in a few paragraphs, then builds alone.
1. `{{cmd}} call breaker`. Append to its packet: the plan, the vetoes, BASE and its diff, every real-run result, finding and dropped attempt (the saved candidates in temporary/), and your own reading labelled an unverified hypothesis.
2. When it returns, record its step back: `{{cmd}} stepback full --targets <IDs> "<the whole, the class and root cause, the step at fault, what it removes, the correction>"`. A target that already failed: `run --before` on BASE.
3. `{{cmd}} merge <id>`, run the affected path, then call reviewer, review, reproduce.
